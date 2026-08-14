import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@bb/plugin-sdk";

import { formatConnection, projectConnection } from "./connection-view.js";
import {
  HandoffAuditSnapshotError,
  HandoffAuditSnapshotStore,
  type HandoffAuditSnapshot,
} from "./handoff-audit-snapshot-store.js";

class CliUsageError extends Error {}

const CLI_USAGE = `Usage:
  bb fabric status [thread-id] [--json]
  bb fabric connect [thread-id] [--json]
  bb fabric command <command-id> [--json]
  bb fabric handoff <transition-id> [--json --page <number> [--snapshot <sha256>]]`;

const FULL_AUDIT_PAGE_BYTES = 256 * 1024;

type HandoffAudit = Awaited<
  ReturnType<BbPluginApi["sdk"]["sessionFabric"]["handoffAudit"]>
>;

interface ParsedCliArgs {
  command: string;
  json: boolean;
  page: number | null;
  positionals: string[];
  snapshot: string | null;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...rest] = argv;
  if (!command) throw new CliUsageError(CLI_USAGE);
  let json = false;
  let page: number | null = null;
  let snapshot: string | null = null;
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === undefined) continue;
    if (value === "--json") {
      if (json) throw new CliUsageError("--json may only be supplied once");
      json = true;
    } else if (value === "--page") {
      if (page !== null) {
        throw new CliUsageError("--page may only be supplied once");
      }
      const rawPage = rest[index + 1];
      if (rawPage === undefined || !/^[1-9]\d*$/.test(rawPage)) {
        throw new CliUsageError("--page requires a positive integer");
      }
      page = Number(rawPage);
      if (!Number.isSafeInteger(page)) {
        throw new CliUsageError("--page exceeds the supported integer range");
      }
      index += 1;
    } else if (value === "--snapshot") {
      if (snapshot !== null) {
        throw new CliUsageError("--snapshot may only be supplied once");
      }
      const rawSnapshot = rest[index + 1];
      if (
        rawSnapshot === undefined ||
        !/^sha256:[a-f0-9]{64}$/.test(rawSnapshot)
      ) {
        throw new CliUsageError(
          "--snapshot requires a sha256 snapshot token from audit page 1",
        );
      }
      snapshot = rawSnapshot;
      index += 1;
    } else if (value.startsWith("-")) {
      throw new CliUsageError(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  if (page !== null && command !== "handoff") {
    throw new CliUsageError("--page is only supported by the handoff command");
  }
  if (page !== null && !json) {
    throw new CliUsageError("--page requires --json");
  }
  if (snapshot !== null && command !== "handoff") {
    throw new CliUsageError(
      "--snapshot is only supported by the handoff command",
    );
  }
  if (snapshot !== null && page === null) {
    throw new CliUsageError("--snapshot requires --page");
  }
  return { command, json, page, positionals, snapshot };
}

function requireThreadId(
  positionals: string[],
  context: PluginCliContext,
): string {
  if (positionals.length > 1) {
    throw new CliUsageError("Expected at most one thread id");
  }
  const threadId = positionals[0] ?? context.threadId;
  if (!threadId) {
    throw new CliUsageError(
      "A thread id is required outside a BB thread context",
    );
  }
  return threadId;
}

function requireIdentifier(positionals: string[], label: string): string {
  if (positionals.length !== 1 || !positionals[0]) {
    throw new CliUsageError(`Exactly one ${label} is required`);
  }
  return positionals[0];
}

function withSignal<T extends object>(
  args: T,
  signal: AbortSignal | undefined,
): T & { signal?: AbortSignal } {
  return signal === undefined ? args : { ...args, signal };
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectHandoffAuditSummary(audit: HandoffAudit) {
  return {
    transition: audit.transition,
    eventCount: audit.events.length,
    evidence: {
      authorization: audit.authorization !== null,
      capsule: audit.capsule !== null,
      review: audit.review !== null,
      restatement: audit.restatement !== null,
      settlement: audit.settlement !== null,
    },
  };
}

function pageHandoffAudit(
  snapshot: HandoffAuditSnapshot,
  page: number,
): string {
  const pageCount = Math.max(
    1,
    Math.ceil(snapshot.bytes.byteLength / FULL_AUDIT_PAGE_BYTES),
  );
  if (page > pageCount) {
    throw new CliUsageError(
      `Audit page ${page} does not exist; expected a page from 1 to ${pageCount}`,
    );
  }
  const start = (page - 1) * FULL_AUDIT_PAGE_BYTES;
  const chunk = snapshot.bytes.subarray(start, start + FULL_AUDIT_PAGE_BYTES);
  return asJson({
    mediaType: "application/json",
    encoding: "base64",
    page,
    pageCount,
    snapshot: snapshot.id,
    decodedBytes: chunk.byteLength,
    totalDecodedBytes: snapshot.bytes.byteLength,
    data: chunk.toString("base64"),
  });
}

function displayToken(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCommandAudit(
  audit: Awaited<
    ReturnType<BbPluginApi["sdk"]["sessionFabric"]["commandAudit"]>
  >,
): string {
  return [
    `Command: ${audit.command.id}`,
    `Kind: ${displayToken(audit.command.kind)}`,
    `Status: ${displayToken(audit.command.status)}`,
    `Binding: ${audit.command.bindingId}`,
    `Events: ${audit.events.length}`,
    `Receipt: ${audit.receipt === null ? "none" : "recorded"}`,
    "",
  ].join("\n");
}

function formatHandoffAudit(
  audit: Awaited<
    ReturnType<BbPluginApi["sdk"]["sessionFabric"]["handoffAudit"]>
  >,
): string {
  const evidence = [
    audit.authorization !== null ? "authorization" : null,
    audit.capsule !== null ? "capsule" : null,
    audit.review !== null ? "review" : null,
    audit.restatement !== null ? "restatement" : null,
    audit.settlement !== null ? "settlement" : null,
  ].filter((value): value is string => value !== null);
  return [
    `Handoff: ${audit.transition.id}`,
    `Phase: ${displayToken(audit.transition.phase)}`,
    `Source binding: ${audit.transition.sourceBindingId}`,
    `Destination thread: ${audit.transition.destinationThreadId}`,
    `Events: ${audit.events.length}`,
    `Evidence: ${evidence.length === 0 ? "none" : evidence.join(", ")}`,
    "",
  ].join("\n");
}

export function registerSessionFabricCli(
  bb: Pick<BbPluginApi, "cli" | "onDispose" | "sdk">,
): void {
  const handoffAuditSnapshots = new HandoffAuditSnapshotStore();
  bb.onDispose(() => handoffAuditSnapshots.dispose());
  bb.cli.register({
    name: "fabric",
    summary: "Inspect and operate portable provider sessions",
    commands: [
      {
        name: "status",
        summary: "Show a thread's Session Fabric connection",
        usage: "bb fabric status [thread-id] [--json]",
      },
      {
        name: "connect",
        summary: "Connect a BB thread to its provider session",
        usage: "bb fabric connect [thread-id] [--json]",
      },
      {
        name: "command",
        summary: "Show the durable audit for one mutation command",
        usage: "bb fabric command <command-id> [--json]",
      },
      {
        name: "handoff",
        summary: "Show or page through the durable audit for one handoff",
        usage:
          "bb fabric handoff <transition-id> [--json --page <number> [--snapshot <sha256>]]",
      },
    ],
    async run(argv, context): Promise<PluginCliResult> {
      if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
        return { exitCode: 0, stdout: `${CLI_USAGE}\n` };
      }
      try {
        const parsed = parseCliArgs(argv);
        if (parsed.command === "status") {
          const threadId = requireThreadId(parsed.positionals, context);
          const result = await bb.sdk.sessionFabric.threadConnection(
            withSignal({ threadId }, context.signal),
          );
          const view = {
            connection:
              result.connection === null
                ? null
                : projectConnection(result.connection),
          };
          return {
            exitCode: 0,
            stdout: parsed.json
              ? asJson(view)
              : formatConnection(view.connection, threadId),
          };
        }
        if (parsed.command === "connect") {
          const threadId = requireThreadId(parsed.positionals, context);
          const result = await bb.sdk.sessionFabric.connectThread(
            withSignal({ threadId }, context.signal),
          );
          const view = { connection: projectConnection(result.connection) };
          return {
            exitCode: 0,
            stdout: parsed.json
              ? asJson(view)
              : formatConnection(view.connection, threadId),
          };
        }
        if (parsed.command === "command") {
          const commandId = requireIdentifier(parsed.positionals, "command id");
          const audit = await bb.sdk.sessionFabric.commandAudit(
            withSignal({ commandId }, context.signal),
          );
          return {
            exitCode: 0,
            stdout: parsed.json ? asJson(audit) : formatCommandAudit(audit),
          };
        }
        if (parsed.command === "handoff") {
          const transitionId = requireIdentifier(
            parsed.positionals,
            "transition id",
          );
          if (parsed.page !== null) {
            if (parsed.page > 1 && parsed.snapshot === null) {
              throw new CliUsageError(
                "Audit pages after page 1 require --snapshot with the token returned by page 1",
              );
            }
            const snapshot =
              parsed.snapshot === null
                ? handoffAuditSnapshots.create(
                    transitionId,
                    await bb.sdk.sessionFabric.handoffAudit(
                      withSignal({ transitionId }, context.signal),
                    ),
                  )
                : handoffAuditSnapshots.require(parsed.snapshot, transitionId);
            return {
              exitCode: 0,
              stdout: pageHandoffAudit(snapshot, parsed.page),
            };
          }
          const audit = await bb.sdk.sessionFabric.handoffAudit(
            withSignal({ transitionId }, context.signal),
          );
          return {
            exitCode: 0,
            stdout: parsed.json
              ? asJson(projectHandoffAuditSummary(audit))
              : formatHandoffAudit(audit),
          };
        }
        throw new CliUsageError(`Unknown command: ${parsed.command}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          stderr: `${error instanceof CliUsageError || error instanceof HandoffAuditSnapshotError ? message : `Session Fabric failed: ${message}`}\n`,
        };
      }
    },
  });
}
