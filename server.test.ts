import { describe, expect, it } from "vitest";
import type { BbPluginApi, PluginCliRegistration } from "@bb/plugin-sdk";

import plugin, { SESSION_FABRIC_PLUGIN_VERSION } from "./server.js";
import { connection, createSessionFabricSdk } from "./test-support/fixtures.js";

interface CapturedHost {
  bb: BbPluginApi;
  cli(): PluginCliRegistration;
  disposeHooks: Array<() => void | Promise<void>>;
  logMessages: string[];
  rpcHandlers(): Record<string, (input: never) => Promise<unknown>>;
  settings: unknown[];
}

function createHost(): CapturedHost {
  let cliRegistration: PluginCliRegistration | undefined;
  let handlers: Record<string, (input: never) => Promise<unknown>> | undefined;
  const logMessages: string[] = [];
  const settings: unknown[] = [];
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const bb = {
    sdk: { sessionFabric: createSessionFabricSdk() },
    settings: {
      define(value: unknown) {
        settings.push(value);
      },
    },
    rpc: {
      register(_contract: unknown, value: typeof handlers) {
        handlers = value;
      },
    },
    cli: {
      register(value: PluginCliRegistration) {
        cliRegistration = value;
      },
    },
    onDispose(hook: () => void | Promise<void>) {
      disposeHooks.push(hook);
    },
    log: {
      info(message: string) {
        logMessages.push(message);
      },
    },
  } as unknown as BbPluginApi;
  return {
    bb,
    cli() {
      if (cliRegistration === undefined) throw new Error("CLI missing");
      return cliRegistration;
    },
    disposeHooks,
    logMessages,
    rpcHandlers() {
      if (handlers === undefined) throw new Error("RPC handlers missing");
      return handlers;
    },
    settings,
  };
}

describe("Session Fabric plugin", () => {
  it("registers settings, typed RPC, CLI, and startup logging", async () => {
    const host = createHost();
    await plugin(host.bb);

    expect(host.settings).toHaveLength(1);
    expect(host.disposeHooks).toHaveLength(1);
    expect(host.cli().name).toBe("fabric");
    await expect(
      host.rpcHandlers().threadConnection({ threadId: "thread-1" } as never),
    ).resolves.toEqual({ connection });
    await expect(
      host.rpcHandlers().threadConnection({ threadId: "missing" } as never),
    ).resolves.toEqual({ connection: null });
    expect(host.logMessages).toContain(
      `Session Fabric ${SESSION_FABRIC_PLUGIN_VERSION} loaded`,
    );
  });

  it("fails activation clearly when the core capability is absent", async () => {
    const incompatible = {
      sdk: {},
    } as unknown as BbPluginApi;

    await expect(plugin(incompatible)).rejects.toThrow(
      "requires a Pierback BB build with bb.sdk.sessionFabric",
    );
  });
});
