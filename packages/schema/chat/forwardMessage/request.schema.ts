import { Static, Type } from '@sinclair/typebox';

export const forwardMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export const forwardMessageBodySchema = Type.Object({
  target_chat_ids: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      uniqueItems: true,
      maxItems: 200,
    })
  ),
  target_contact_ids: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      uniqueItems: true,
      maxItems: 200,
    })
  ),
  worker_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ForwardMessageParams = Static<typeof forwardMessageParamsSchema>;
export type ForwardMessageBody = Static<typeof forwardMessageBodySchema>;
