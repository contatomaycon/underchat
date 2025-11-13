import { Static, Type } from '@sinclair/typebox';

export const reactMessageParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export const reactMessageBodySchema = Type.Object({
  emoji: Type.String(),
});

export type ReactMessageParams = Static<typeof reactMessageParamsSchema>;
export type ReactMessageBody = Static<typeof reactMessageBodySchema>;

