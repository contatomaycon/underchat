import { Static, Type } from '@sinclair/typebox';

export const chatUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export type ChatUserResponse = Static<typeof chatUserResponseSchema>;

export const listChatUsersResponseSchema = Type.Array(chatUserResponseSchema);

export type ListChatUsersResponse = Static<typeof listChatUsersResponseSchema>;
