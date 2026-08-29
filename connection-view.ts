import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { SessionFabricConnectionView } from "./contract.js";

type ThreadConnectionResult = Awaited<
  ReturnType<
    BbPluginApi["sdk"]["experimental_sessionFabric"]["threadConnection"]
  >
>;
type CoreConnection = NonNullable<ThreadConnectionResult["connection"]>;

/**
 * Project BB's authoritative SDK result into the plugin-owned wire contract.
 * The frontend never imports server, domain, or daemon implementation types.
 */
export function projectConnection(
  connection: CoreConnection,
): SessionFabricConnectionView {
  return {
    adoptionStatus: connection.adoptionStatus,
    bindingId: connection.bindingId,
    controlEpoch: connection.controlEpoch,
    effectiveModel: connection.effectiveModel,
    environmentId: connection.environmentId,
    isActiveAuthority: connection.isActiveAuthority,
    mutationPolicy: connection.mutationPolicy,
    nativeConversation: {
      catalogConversationId:
        connection.nativeConversation.catalogConversationId,
      cwd: connection.nativeConversation.cwd,
      hostId: connection.nativeConversation.hostId,
      lastObservedAt: connection.nativeConversation.lastObservedAt,
      nativeConversationId: connection.nativeConversation.nativeConversationId,
      providerId: connection.nativeConversation.providerId,
      providerInstanceId: connection.nativeConversation.providerInstanceId,
      providerState: connection.nativeConversation.providerState,
      title: connection.nativeConversation.title,
    },
    openedAt: connection.openedAt,
    ownership: connection.ownership,
    phase: connection.phase,
    reasoningLevel: connection.reasoningLevel,
    runtime: connection.runtime,
    serviceTier: connection.serviceTier,
    threadId: connection.threadId,
    updatedAt: connection.updatedAt,
  };
}

function displayToken(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatConnection(
  connection: SessionFabricConnectionView | null,
  threadId: string,
): string {
  if (connection === null) {
    return `Thread ${threadId} is not connected to Session Fabric.\n`;
  }
  const conversation =
    connection.nativeConversation.title ??
    connection.nativeConversation.nativeConversationId;
  const model = connection.effectiveModel
    ? `${connection.effectiveModel.providerId}/${connection.effectiveModel.modelId}`
    : "not reported";
  const runtime = connection.runtime
    ? `${displayToken(connection.runtime.status)} (${connection.runtime.id})`
    : "not attached";
  return [
    `Thread: ${connection.threadId}`,
    `Conversation: ${conversation}`,
    `Provider: ${connection.nativeConversation.providerId} (${connection.nativeConversation.providerInstanceId})`,
    `Host: ${connection.nativeConversation.hostId}`,
    `State: ${displayToken(connection.phase)} · ${connection.isActiveAuthority ? "active authority" : "not authority"} · ${displayToken(connection.mutationPolicy)}`,
    `Runtime: ${runtime}`,
    `Model: ${model}`,
    `Binding: ${connection.bindingId} (epoch ${connection.controlEpoch})`,
    "",
  ].join("\n");
}
