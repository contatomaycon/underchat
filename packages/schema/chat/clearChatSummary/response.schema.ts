import { Static, Type } from '@sinclair/typebox';
import { listChatsResultSchema } from '../listChats/response.schema';

export const clearChatSummaryResponseSchema = Type.Object({
  status: Type.Boolean(),
  message: Type.String(),
  data: listChatsResultSchema,
});

export type ClearChatSummaryResponse = Static<
  typeof clearChatSummaryResponseSchema
>;
