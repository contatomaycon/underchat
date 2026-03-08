import { Static, Type } from '@sinclair/typebox';

export const leaveChatParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const leaveChatBodySchema = Type.Object(
  {},
  {
    additionalProperties: false,
  }
);

export type LeaveChatParams = Static<typeof leaveChatParamsSchema>;
export type LeaveChatBody = Static<typeof leaveChatBodySchema> | undefined;
