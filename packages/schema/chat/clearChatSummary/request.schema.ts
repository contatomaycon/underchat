import { Static, Type } from '@sinclair/typebox';

export const clearChatSummaryParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const clearChatSummaryBodySchema = Type.Object({});

export type ClearChatSummaryParams = Static<
  typeof clearChatSummaryParamsSchema
>;
export type ClearChatSummaryBody = Static<typeof clearChatSummaryBodySchema>;
