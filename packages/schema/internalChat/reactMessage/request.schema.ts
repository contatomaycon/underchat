import { Static, Type } from '@sinclair/typebox';

export const reactMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});
export const reactMessageQuerySchema = Type.Object({});
export const reactMessageBodySchema = Type.Object({
  emoji: Type.Union([Type.String(), Type.Null()]),
});

export type ReactMessageParams = Static<typeof reactMessageParamsSchema>;
export type ReactMessageBody = Static<typeof reactMessageBodySchema>;
