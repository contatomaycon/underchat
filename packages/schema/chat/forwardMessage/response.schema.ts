import { Static, Type } from '@sinclair/typebox';

export const forwardMessageResultSchema = Type.Object({
  target_type: Type.String({ enum: ['chat', 'contact'] }),
  target_chat_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  target_contact_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.String({ enum: ['sent', 'failed'] }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const forwardMessageResponseSchema = Type.Object({
  requested: Type.Number(),
  sent: Type.Number(),
  failed: Type.Number(),
  results: Type.Array(forwardMessageResultSchema),
});

export type ForwardMessageResult = Static<typeof forwardMessageResultSchema>;
export type ForwardMessageResponse = Static<
  typeof forwardMessageResponseSchema
>;
