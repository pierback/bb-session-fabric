import { createHash } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SNAPSHOTS = 4;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export class HandoffAuditSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffAuditSnapshotError";
  }
}

export interface HandoffAuditSnapshot {
  readonly bytes: Buffer;
  readonly expiresAt: number;
  readonly id: string;
  readonly transitionId: string;
}

interface StoredHandoffAuditSnapshot extends HandoffAuditSnapshot {
  readonly cleanupTimer: ReturnType<typeof setTimeout>;
}

export interface HandoffAuditSnapshotStoreOptions {
  readonly maxSnapshots?: number;
  readonly maxTotalBytes?: number;
  readonly ttlMs?: number;
}

class JsonSnapshotEncoder {
  #bytes = 0;
  readonly #hash = createHash("sha256");

  constructor(readonly maxBytes: number) {}

  get bytes(): number {
    return this.#bytes;
  }

  digestId(): string {
    return `sha256:${this.#hash.digest("hex")}`;
  }

  writeToken(value: string): void {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > this.maxBytes - this.#bytes) {
      throw snapshotByteBudgetError(this.maxBytes);
    }
    this.#bytes += bytes;
    this.#hash.update(value, "utf8");
  }

  writeJsonString(value: string): void {
    this.writeToken('"');
    let safeStart = 0;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      let escape: string | null = null;
      if (codeUnit === 0x22) escape = '\\"';
      else if (codeUnit === 0x5c) escape = "\\\\";
      else if (codeUnit === 0x08) escape = "\\b";
      else if (codeUnit === 0x09) escape = "\\t";
      else if (codeUnit === 0x0a) escape = "\\n";
      else if (codeUnit === 0x0c) escape = "\\f";
      else if (codeUnit === 0x0d) escape = "\\r";
      else if (codeUnit <= 0x1f) escape = unicodeEscape(codeUnit);
      else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const nextCodeUnit = value.charCodeAt(index + 1);
        if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
          index += 1;
        } else {
          escape = unicodeEscape(codeUnit);
        }
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        escape = unicodeEscape(codeUnit);
      }
      if (escape !== null) {
        if (safeStart < index) {
          this.writeToken(value.slice(safeStart, index));
        }
        this.writeToken(escape);
        safeStart = index + 1;
      }
    }
    if (safeStart < value.length) this.writeToken(value.slice(safeStart));
    this.writeToken('"');
  }
}

function unicodeEscape(codeUnit: number): string {
  return `\\u${codeUnit.toString(16).padStart(4, "0")}`;
}

function formatByteBudget(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes)
    ? `${mebibytes} MiB`
    : `${bytes.toLocaleString("en-US")} bytes`;
}

function snapshotByteBudgetError(bytes: number): HandoffAuditSnapshotError {
  return new HandoffAuditSnapshotError(
    `Handoff audit snapshot exceeds the ${formatByteBudget(bytes)} cumulative byte budget; use the bounded handoff summary instead`,
  );
}

function isOmittedJsonValue(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  );
}

function normalizeJsonValue(
  value: unknown,
  encoder: JsonSnapshotEncoder,
  ancestors: Set<object>,
): JsonValue {
  if (value === null) {
    encoder.writeToken("null");
    return null;
  }
  if (typeof value === "string") {
    encoder.writeJsonString(value);
    return value;
  }
  if (typeof value === "boolean") {
    encoder.writeToken(value ? "true" : "false");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      encoder.writeToken("null");
      return null;
    }
    const serialized = JSON.stringify(value);
    encoder.writeToken(serialized);
    return value;
  }
  if (isOmittedJsonValue(value) || typeof value === "bigint") {
    throw new HandoffAuditSnapshotError(
      "Handoff audit contains a value that cannot be serialized as JSON",
    );
  }
  if (typeof value !== "object") {
    throw new HandoffAuditSnapshotError(
      "Handoff audit contains an unsupported JSON value",
    );
  }
  if (ancestors.has(value)) {
    throw new HandoffAuditSnapshotError(
      "Handoff audit contains a circular reference",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      encoder.writeToken("[");
      const normalized: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) encoder.writeToken(",");
        const item = value[index];
        if (isOmittedJsonValue(item)) {
          encoder.writeToken("null");
          normalized.push(null);
        } else {
          normalized.push(normalizeJsonValue(item, encoder, ancestors));
        }
      }
      encoder.writeToken("]");
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new HandoffAuditSnapshotError(
        "Handoff audit must contain only plain JSON objects",
      );
    }
    encoder.writeToken("{");
    const normalized = Object.create(null) as { [key: string]: JsonValue };
    let propertyCount = 0;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (isOmittedJsonValue(item)) continue;
      if (propertyCount > 0) encoder.writeToken(",");
      encoder.writeJsonString(key);
      encoder.writeToken(":");
      normalized[key] = normalizeJsonValue(item, encoder, ancestors);
      propertyCount += 1;
    }
    encoder.writeToken("}");
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function encodeWithinBudget(
  value: unknown,
  maxBytes: number,
): { bytes: number; id: string; value: JsonValue } {
  const encoder = new JsonSnapshotEncoder(maxBytes);
  const normalized = normalizeJsonValue(value, encoder, new Set());
  return {
    bytes: encoder.bytes,
    id: encoder.digestId(),
    value: normalized,
  };
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export class HandoffAuditSnapshotStore {
  readonly #maxSnapshots: number;
  readonly #maxTotalBytes: number;
  readonly #snapshots = new Map<string, StoredHandoffAuditSnapshot>();
  readonly #ttlMs: number;
  #disposed = false;
  #totalBytes = 0;

  constructor(options: HandoffAuditSnapshotStoreOptions = {}) {
    this.#maxSnapshots = requirePositiveInteger(
      options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS,
      "maxSnapshots",
    );
    this.#maxTotalBytes = requirePositiveInteger(
      options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      "maxTotalBytes",
    );
    this.#ttlMs = requirePositiveInteger(
      options.ttlMs ?? DEFAULT_TTL_MS,
      "ttlMs",
    );
  }

  create(transitionId: string, audit: unknown): HandoffAuditSnapshot {
    this.#assertActive();
    this.#deleteExpired();
    const encoded = encodeWithinBudget(audit, this.#maxTotalBytes);
    const existing = this.#snapshots.get(encoded.id);
    if (existing !== undefined) {
      if (existing.transitionId !== transitionId) {
        throw new HandoffAuditSnapshotError(
          "Handoff audit snapshot content conflicts with its transition id",
        );
      }
      return existing;
    }
    if (this.#snapshots.size >= this.#maxSnapshots) {
      throw new HandoffAuditSnapshotError(
        `At most ${this.#maxSnapshots} handoff audit snapshots may be active; finish or wait for an existing snapshot to expire`,
      );
    }
    if (encoded.bytes > this.#maxTotalBytes - this.#totalBytes) {
      throw snapshotByteBudgetError(this.#maxTotalBytes);
    }

    const serialized = JSON.stringify(encoded.value);
    const bytes = Buffer.from(serialized, "utf8");
    if (bytes.byteLength !== encoded.bytes) {
      throw new Error("Handoff audit snapshot byte accounting mismatch");
    }
    const id = encoded.id;

    const expiresAt = Date.now() + this.#ttlMs;
    const cleanupTimer = setTimeout(() => {
      const current = this.#snapshots.get(id);
      if (current?.expiresAt === expiresAt) this.#delete(id);
    }, this.#ttlMs);
    cleanupTimer.unref();
    const snapshot = {
      bytes,
      cleanupTimer,
      expiresAt,
      id,
      transitionId,
    };
    this.#snapshots.set(id, snapshot);
    this.#totalBytes += bytes.byteLength;
    return snapshot;
  }

  require(id: string, transitionId: string): HandoffAuditSnapshot {
    this.#assertActive();
    this.#deleteExpired();
    const snapshot = this.#snapshots.get(id);
    if (snapshot === undefined || snapshot.transitionId !== transitionId) {
      throw new HandoffAuditSnapshotError(
        "Audit snapshot is unavailable; request page 1 again to create a new snapshot",
      );
    }
    return snapshot;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const id of [...this.#snapshots.keys()]) this.#delete(id);
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new HandoffAuditSnapshotError(
        "Audit snapshot store is unavailable because the plugin is disposing",
      );
    }
  }

  #delete(id: string): void {
    const snapshot = this.#snapshots.get(id);
    if (snapshot === undefined) return;
    clearTimeout(snapshot.cleanupTimer);
    this.#snapshots.delete(id);
    this.#totalBytes -= snapshot.bytes.byteLength;
  }

  #deleteExpired(): void {
    const now = Date.now();
    for (const [id, snapshot] of this.#snapshots) {
      if (snapshot.expiresAt <= now) this.#delete(id);
    }
  }
}
