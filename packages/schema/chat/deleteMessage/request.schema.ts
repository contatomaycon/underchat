import { Static, Type } from '@sinclair/typebox';

export const deleteMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export const deleteMessageBodySchema = Type.Object({});

export type DeleteMessageParams = Static<typeof deleteMessageParamsSchema>;
export type DeleteMessageBody = Static<typeof deleteMessageBodySchema>;

