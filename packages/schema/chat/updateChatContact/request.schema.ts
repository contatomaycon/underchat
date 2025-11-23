import { Static, Type } from '@sinclair/typebox';

export const updateChatContactParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const updateChatContactBodySchema = Type.Object({
  phone: Type.String(),
  phone_ddi: Type.String(),
});

export type UpdateChatContactParams = Static<
  typeof updateChatContactParamsSchema
>;

export type UpdateChatContactBody = Static<typeof updateChatContactBodySchema>;
