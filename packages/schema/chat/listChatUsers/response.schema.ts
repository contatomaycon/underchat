import { Static, Type } from '@sinclair/typebox';

export const chatUserResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  name: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ChatUserResponse = Static<typeof chatUserResponseSchema>;

export const listChatUsersResponseSchema = Type.Array(chatUserResponseSchema);

export type ListChatUsersResponse = Static<typeof listChatUsersResponseSchema>;
