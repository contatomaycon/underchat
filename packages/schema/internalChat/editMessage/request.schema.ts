import { Static, Type } from '@sinclair/typebox';

export const editMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});
export const editMessageQuerySchema = Type.Object({});
export const editMessageBodySchema = Type.Object({
  message: Type.String(),
});

export type EditMessageParams = Static<typeof editMessageParamsSchema>;
export type EditMessageBody = Static<typeof editMessageBodySchema>;
