import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HandoffAuditSnapshotStore,
  HandoffAuditSnapshotError,
} from "./handoff-audit-snapshot-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("HandoffAuditSnapshotStore", () => {
  it("accounts for JSON escaping and UTF-8 exactly", () => {
    const store = new HandoffAuditSnapshotStore({ maxTotalBytes: 1_024 });
    const audit = {
      array: [true, null, -0, Number.POSITIVE_INFINITY],
      escaped: 'quote " slash \\ controls \b\t\n\f\r\u0000',
      unicode: `Grüße 😀 ${String.fromCharCode(0xd800)}`,
    };

    const snapshot = store.create("transition-1", audit);

    expect(snapshot.bytes.byteLength).toBe(
      Buffer.byteLength(JSON.stringify(audit), "utf8"),
    );
    expect(snapshot.id).toBe(
      `sha256:${createHash("sha256").update(snapshot.bytes).digest("hex")}`,
    );
    expect(JSON.parse(snapshot.bytes.toString("utf8"))).toEqual(
      JSON.parse(JSON.stringify(audit)),
    );
  });

  it("recognizes an unchanged retry at count and byte capacity", () => {
    vi.useFakeTimers();
    const store = new HandoffAuditSnapshotStore({
      maxSnapshots: 1,
      maxTotalBytes: 34,
    });
    const audit = { payload: "x".repeat(20) };
    const first = store.create("transition-1", audit);
    let inspections = 0;
    const rejectedAudit = Object.defineProperty({}, "payload", {
      enumerable: true,
      get() {
        inspections += 1;
        return audit.payload;
      },
    });

    expect(store.create("transition-1", rejectedAudit)).toBe(first);
    expect(inspections).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("preserves existing snapshots when the cumulative byte budget is full", () => {
    const store = new HandoffAuditSnapshotStore({ maxTotalBytes: 80 });
    const first = store.create("transition-1", { payload: "x".repeat(20) });

    expect(() =>
      store.create("transition-2", { payload: "y".repeat(60) }),
    ).toThrow(HandoffAuditSnapshotError);
    expect(store.require(first.id, "transition-1")).toBe(first);
  });

  it("stops measuring an oversized audit before traversing later fields", () => {
    const store = new HandoffAuditSnapshotStore({ maxTotalBytes: 64 });
    let trailingFieldRead = false;
    const audit = Object.defineProperties(
      {},
      {
        payload: { enumerable: true, value: "x".repeat(100) },
        trailing: {
          enumerable: true,
          get() {
            trailingFieldRead = true;
            return "must not be read";
          },
        },
      },
    );

    expect(() => store.create("transition-1", audit)).toThrow(
      "cumulative byte budget",
    );
    expect(trailingFieldRead).toBe(false);
  });

  it("reclaims count and bytes when a snapshot expires", async () => {
    vi.useFakeTimers();
    const store = new HandoffAuditSnapshotStore({
      maxSnapshots: 1,
      maxTotalBytes: 40,
      ttlMs: 1_000,
    });
    const expired = store.create("transition-1", {
      payload: "x".repeat(20),
    });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(() => store.require(expired.id, "transition-1")).toThrow(
      "Audit snapshot is unavailable",
    );
    expect(() =>
      store.create("transition-2", { payload: "y".repeat(20) }),
    ).not.toThrow();
  });

  it("clears retained snapshots and timers when disposed", () => {
    vi.useFakeTimers();
    const store = new HandoffAuditSnapshotStore();
    const snapshot = store.create("transition-1", { id: 1 });
    expect(vi.getTimerCount()).toBe(1);

    store.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(() => store.require(snapshot.id, "transition-1")).toThrow(
      "plugin is disposing",
    );
    expect(() => store.create("transition-2", { id: 2 })).toThrow(
      "plugin is disposing",
    );
  });
});
