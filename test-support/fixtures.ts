import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { SessionFabricConnectionView } from "../contract.js";

export const connection: SessionFabricConnectionView = {
  adoptionStatus: "enabled",
  bindingId: "binding-1",
  controlEpoch: 4,
  effectiveModel: { modelId: "gpt-5.6", providerId: "codex" },
  environmentId: "environment-1",
  isActiveAuthority: true,
  mutationPolicy: "enabled",
  nativeConversation: {
    catalogConversationId: "catalog-1",
    cwd: "/workspace/project",
    hostId: "host-this-mac",
    lastObservedAt: 1_786_000_000_000,
    nativeConversationId: "conversation-1",
    providerId: "codex",
    providerInstanceId: "codex-default",
    providerState: "idle",
    title: "Implement portable sessions",
  },
  openedAt: 1_785_000_000_000,
  ownership: "owned_brokered",
  phase: "idle",
  reasoningLevel: "high",
  runtime: { id: "runtime-1", status: "live" },
  serviceTier: "fast",
  threadId: "thread-1",
  updatedAt: 1_786_000_000_000,
};

export function createSessionFabricSdk(): BbPluginApi["sdk"]["experimental_sessionFabric"] {
  const sdk = {
    async threadConnection({ threadId }) {
      return {
        connection: threadId === connection.threadId ? connection : null,
      } as never;
    },
    async connectThread({ threadId }) {
      return {
        connection: { ...connection, threadId },
      } as never;
    },
    async commandAudit({ commandId }) {
      return {
        command: {
          id: commandId,
          kind: "change_model",
          status: "committed",
          bindingId: connection.bindingId,
        },
        events: [{ id: "event-1" }],
        modelEpoch: null,
        receipt: { id: "receipt-1" },
      } as never;
    },
    async handoffAudit({ transitionId }) {
      return {
        transition: {
          id: transitionId,
          phase: "completed",
          sourceBindingId: connection.bindingId,
          destinationThreadId: "thread-2",
        },
        events: [],
        authorization: { id: "authorization-1" },
        capsule: { id: "capsule-1" },
        review: null,
        restatement: null,
        settlement: { id: "settlement-1" },
      } as never;
    },
  } satisfies Partial<BbPluginApi["sdk"]["experimental_sessionFabric"]>;
  return sdk as unknown as BbPluginApi["sdk"]["experimental_sessionFabric"];
}
