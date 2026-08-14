import type { BbPluginApi } from "@bb/plugin-sdk";

import { registerSessionFabricCli } from "./cli.js";
import { projectConnection } from "./connection-view.js";
import { sessionFabricRpcContract } from "./contract.js";

export const SESSION_FABRIC_PLUGIN_VERSION = "0.1.0";

function requireSessionFabricCapability(bb: BbPluginApi): void {
  const sdk = bb.sdk as BbPluginApi["sdk"] & {
    sessionFabric?: BbPluginApi["sdk"]["sessionFabric"];
  };
  if (sdk.sessionFabric === undefined) {
    throw new Error(
      "Session Fabric requires a Pierback BB build with bb.sdk.sessionFabric",
    );
  }
}

export default async function plugin(bb: BbPluginApi) {
  requireSessionFabricCapability(bb);

  bb.settings.define({
    showTechnicalIdentifiers: {
      type: "boolean",
      label: "Show technical identifiers",
      description:
        "Show binding, runtime, provider-instance, environment, and native conversation identifiers in the thread panel.",
      default: false,
    },
  });

  bb.rpc.register(sessionFabricRpcContract, {
    async threadConnection({ threadId }) {
      const result = await bb.sdk.sessionFabric.threadConnection({ threadId });
      return {
        connection:
          result.connection === null
            ? null
            : projectConnection(result.connection),
      };
    },
    async connectThread({ threadId }) {
      const result = await bb.sdk.sessionFabric.connectThread({ threadId });
      return { connection: projectConnection(result.connection) };
    },
  });

  registerSessionFabricCli(bb);
  bb.log.info(`Session Fabric ${SESSION_FABRIC_PLUGIN_VERSION} loaded`);
}
