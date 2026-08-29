import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliRegistration,
} from "@get-bb/plugin-sdk";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "@get-bb/plugin-sdk";

import { registerSessionFabricCli } from "./cli.js";
import { createSessionFabricSdk } from "./test-support/fixtures.js";

function registeredCli(
  sessionFabric = createSessionFabricSdk(),
): PluginCliRegistration {
  let registration: PluginCliRegistration | undefined;
  registerSessionFabricCli({
    sdk: { experimental_sessionFabric: sessionFabric } as BbPluginApi["sdk"],
    onDispose() {},
    cli: {
      register(value) {
        registration = value;
      },
    } as BbPluginApi["cli"],
  });
  if (registration === undefined) throw new Error("CLI was not registered");
  return registration;
}

const outsideThread: PluginCliContext = {};

afterEach(() => {
  vi.useRealTimers();
});

describe("Session Fabric CLI", () => {
  it("renders status and durable audit summaries", async () => {
    const cli = registeredCli();

    await expect(
      cli.run(["status", "thread-1"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("active authority"),
    });
    await expect(
      cli.run(["command", "command-1"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("Status: committed"),
    });
    await expect(
      cli.run(["handoff", "transition-1"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining(
        "Evidence: authorization, capsule, settlement",
      ),
    });
  });

  it("uses thread context and produces stable JSON", async () => {
    const cli = registeredCli();
    const result = await cli.run(["connect", "--json"], {
      threadId: "thread-context",
    } as PluginCliContext);

    expect(result.exitCode).toBe(0);
    if (result.stdout === undefined) {
      throw new Error("connect JSON output was not written");
    }
    expect(JSON.parse(result.stdout)).toMatchObject({
      connection: { threadId: "thread-context", bindingId: "binding-1" },
    });
  });

  it("keeps handoff JSON bounded and exports the full audit in safe pages", async () => {
    const sessionFabric = createSessionFabricSdk();
    const baseAudit = await sessionFabric.handoffAudit({
      transitionId: "transition-large",
    });
    if (baseAudit.capsule === null) {
      throw new Error("large audit fixture requires a capsule");
    }
    const audit = {
      ...baseAudit,
      capsule: {
        ...baseAudit.capsule,
        plan: Array.from({ length: 40 }, (_, index) =>
          `${index}:`.padEnd(32_768, "x"),
        ),
      },
    };
    let currentAudit = audit;
    let handoffAuditCalls = 0;
    sessionFabric.handoffAudit = async () => {
      handoffAuditCalls += 1;
      return currentAudit;
    };
    const cli = registeredCli(sessionFabric);

    const summary = await cli.run(
      ["handoff", "transition-large", "--json"],
      outsideThread,
    );
    expect(summary.exitCode).toBe(0);
    if (summary.stdout === undefined) {
      throw new Error("handoff JSON summary was not written");
    }
    expect(Buffer.byteLength(summary.stdout, "utf8")).toBeLessThan(
      PLUGIN_CLI_OUTPUT_MAX_BYTES,
    );
    expect(JSON.parse(summary.stdout)).toMatchObject({
      eventCount: audit.events.length,
      evidence: { capsule: true },
      transition: { id: "transition-large" },
    });
    expect(summary.stdout).not.toContain(audit.capsule.plan[0]);

    const firstResult = await cli.run(
      ["handoff", "transition-large", "--json", "--page", "1"],
      outsideThread,
    );
    if (firstResult.stdout === undefined) {
      throw new Error("first handoff audit page was not written");
    }
    const firstPage = JSON.parse(firstResult.stdout) as {
      data: string;
      pageCount: number;
      snapshot: string;
    };
    expect(firstPage.pageCount).toBeGreaterThan(1);
    expect(firstPage.snapshot).toMatch(/^sha256:[a-f0-9]{64}$/);
    currentAudit = {
      ...audit,
      capsule: { ...audit.capsule, plan: ["new live handoff state"] },
    };

    const chunks: Buffer[] = [];
    for (let page = 1; page <= firstPage.pageCount; page += 1) {
      const result =
        page === 1
          ? firstResult
          : await cli.run(
              [
                "handoff",
                "transition-large",
                "--json",
                "--page",
                String(page),
                "--snapshot",
                firstPage.snapshot,
              ],
              outsideThread,
            );
      if (result.stdout === undefined) {
        throw new Error(`handoff audit page ${page} was not written`);
      }
      expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThan(
        PLUGIN_CLI_OUTPUT_MAX_BYTES,
      );
      const payload = JSON.parse(result.stdout) as {
        data: string;
        encoding: string;
        mediaType: string;
        page: number;
        pageCount: number;
        snapshot: string;
      };
      expect(payload).toMatchObject({
        encoding: "base64",
        mediaType: "application/json",
        page,
        pageCount: firstPage.pageCount,
        snapshot: firstPage.snapshot,
      });
      chunks.push(Buffer.from(payload.data, "base64"));
    }
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(audit);
    expect(handoffAuditCalls).toBe(2);
  });

  it("preserves active snapshot tokens at capacity and reclaims them on expiry", async () => {
    vi.useFakeTimers();
    const sessionFabric = createSessionFabricSdk();
    const baseAudit = await sessionFabric.handoffAudit({
      transitionId: "transition-capacity",
    });
    if (baseAudit.capsule === null) {
      throw new Error("snapshot capacity fixture requires a capsule");
    }
    const capsule = baseAudit.capsule;
    sessionFabric.handoffAudit = async ({ transitionId }) => ({
      ...baseAudit,
      transition: { ...baseAudit.transition, id: transitionId },
      capsule: {
        ...capsule,
        plan: [transitionId.padEnd(300_000, "x")],
      },
    });
    const cli = registeredCli(sessionFabric);
    const snapshots: string[] = [];

    for (let index = 1; index <= 4; index += 1) {
      const result = await cli.run(
        ["handoff", `transition-${index}`, "--json", "--page", "1"],
        outsideThread,
      );
      expect(result.exitCode).toBe(0);
      if (result.stdout === undefined) {
        throw new Error(`snapshot ${index} did not return page 1`);
      }
      snapshots.push(
        (JSON.parse(result.stdout) as { snapshot: string }).snapshot,
      );
    }
    expect(vi.getTimerCount()).toBe(4);

    await expect(
      cli.run(
        ["handoff", "transition-5", "--json", "--page", "1"],
        outsideThread,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining(
        "At most 4 handoff audit snapshots may be active",
      ),
    });
    expect(vi.getTimerCount()).toBe(4);

    await expect(
      cli.run(
        [
          "handoff",
          "transition-1",
          "--json",
          "--page",
          "2",
          "--snapshot",
          snapshots[0]!,
        ],
        outsideThread,
      ),
    ).resolves.toMatchObject({ exitCode: 0 });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      cli.run(
        [
          "handoff",
          "transition-1",
          "--json",
          "--page",
          "2",
          "--snapshot",
          snapshots[0]!,
        ],
        outsideThread,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("Audit snapshot is unavailable"),
    });
  });

  it("rejects missing identifiers and unknown short or long options", async () => {
    const cli = registeredCli();

    await expect(cli.run(["status"], outsideThread)).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("thread id is required"),
    });
    await expect(
      cli.run(["status", "-x"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "Unknown option: -x\n",
    });
    await expect(
      cli.run(["status", "--wat"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "Unknown option: --wat\n",
    });
    await expect(
      cli.run(["handoff", "transition-1", "--page", "1"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--page requires --json\n",
    });
    await expect(
      cli.run(["status", "thread-1", "--json", "--page", "1"], outsideThread),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--page is only supported by the handoff command\n",
    });
    await expect(
      cli.run(
        ["handoff", "transition-1", "--json", "--page", "2"],
        outsideThread,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr:
        "Audit pages after page 1 require --snapshot with the token returned by page 1\n",
    });
  });
});
