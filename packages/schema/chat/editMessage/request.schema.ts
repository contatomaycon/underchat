import { Static, Type } from '@sinclair/typebox';

export const editMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export const editMessageBodySchema = Type.Object({
  message: Type.String(),
});

export type EditMessageParams = Static<typeof editMessageParamsSchema>;
export type EditMessageBody = Static<typeof editMessageBodySchema>;
