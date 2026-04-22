import { Static, Type } from '@sinclair/typebox';

export const bulkActionChatFailureSchema = Type.Object({
  chat_id: Type.Union([Type.String(), Type.Null()]),
  message: Type.String(),
});

export const bulkActionChatResponseSchema = Type.Object({
  total_targeted: Type.Number(),
  success_count: Type.Number(),
  failed_count: Type.Number(),
  failures: Type.Array(bulkActionChatFailureSchema),
});

export type BulkActionChatResponse = Static<
  typeof bulkActionChatResponseSchema
>;
