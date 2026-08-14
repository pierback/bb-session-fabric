import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const sessionFabricConnectionViewSchema = z
  .object({
    adoptionStatus: z.enum(["enabled", "prepared", "host_bound"]).nullable(),
    bindingId: z.string().min(1),
    controlEpoch: z.number().int().nonnegative(),
    effectiveModel: z
      .object({
        modelId: z.string().min(1),
        providerId: z.string().min(1),
      })
      .strict()
      .nullable(),
    environmentId: z.string().min(1).nullable(),
    isActiveAuthority: z.boolean(),
    mutationPolicy: z.string().min(1),
    nativeConversation: z
      .object({
        catalogConversationId: z.string().min(1),
        cwd: z.string().min(1).nullable(),
        hostId: z.string().min(1),
        lastObservedAt: z.number().int().nonnegative(),
        nativeConversationId: z.string().min(1),
        providerId: z.string().min(1),
        providerInstanceId: z.string().min(1),
        providerState: z.string().min(1),
        title: z.string().min(1).nullable(),
      })
      .strict(),
    openedAt: z.number().int().nonnegative(),
    ownership: z.string().min(1),
    phase: z.string().min(1),
    reasoningLevel: z.string().min(1).nullable(),
    runtime: z
      .object({
        id: z.string().min(1),
        status: z.string().min(1),
      })
      .strict()
      .nullable(),
    serviceTier: z.string().min(1).nullable(),
    threadId: z.string().min(1),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type SessionFabricConnectionView = z.infer<
  typeof sessionFabricConnectionViewSchema
>;

const threadInputSchema = z
  .object({ threadId: z.string().trim().min(1) })
  .strict();

export const sessionFabricRpcContract = defineRpcContract({
  threadConnection: {
    input: threadInputSchema,
    output: z
      .object({ connection: sessionFabricConnectionViewSchema.nullable() })
      .strict(),
  },
  connectThread: {
    input: threadInputSchema,
    output: z
      .object({ connection: sessionFabricConnectionViewSchema })
      .strict(),
  },
});
