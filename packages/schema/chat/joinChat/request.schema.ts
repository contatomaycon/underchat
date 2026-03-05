import { Static, Type } from '@sinclair/typebox';

export const joinChatParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const joinChatBodySchema = Type.Object(
  {},
  {
    additionalProperties: false,
  }
);

export type JoinChatParams = Static<typeof joinChatParamsSchema>;
export type JoinChatBody = Static<typeof joinChatBodySchema> | undefined;
