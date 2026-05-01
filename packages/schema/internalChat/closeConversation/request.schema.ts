import { Static, Type } from '@sinclair/typebox';

export const closeConversationParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const closeConversationQuerySchema = Type.Object({});
export const closeConversationBodySchema = Type.Object({});

export type CloseConversationParams = Static<
  typeof closeConversationParamsSchema
>;
