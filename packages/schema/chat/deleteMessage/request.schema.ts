import { Static, Type } from '@sinclair/typebox';

export const deleteMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export type DeleteMessageParams = Static<typeof deleteMessageParamsSchema>;
