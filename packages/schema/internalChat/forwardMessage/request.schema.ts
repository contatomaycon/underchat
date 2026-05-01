import { Static, Type } from '@sinclair/typebox';

export const forwardMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});
export const forwardMessageQuerySchema = Type.Object({});
export const forwardMessageBodySchema = Type.Object({
  target_conversation_ids: Type.Array(Type.String({ format: 'uuid' }), {
    minItems: 1,
  }),
});

export type ForwardMessageParams = Static<typeof forwardMessageParamsSchema>;
export type ForwardMessageBody = Static<typeof forwardMessageBodySchema>;
