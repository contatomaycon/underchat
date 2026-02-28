import { Static, Type } from '@sinclair/typebox';

export const forwardMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export const forwardMessageBodySchema = Type.Object({
  target_chat_ids: Type.Array(Type.String(), {
    minItems: 1,
    uniqueItems: true,
    maxItems: 200,
  }),
});

export type ForwardMessageParams = Static<typeof forwardMessageParamsSchema>;
export type ForwardMessageBody = Static<typeof forwardMessageBodySchema>;
