import { Static, Type } from '@sinclair/typebox';

export const viewConversationParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const viewConversationQuerySchema = Type.Object({});
export const viewConversationBodySchema = Type.Object({});

export type ViewConversationParams = Static<
  typeof viewConversationParamsSchema
>;
