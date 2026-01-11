import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { Static, Type } from '@sinclair/typebox';

export const listChatsUserResponseSchema = Type.Object({
  chat_user_id: Type.String(),
  about: Type.Union([Type.String(), Type.Null()]),
  status: Type.String({ enum: Object.values(EChatUserStatus) }),
  notifications: Type.Boolean(),
  sort_by_chat_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_in_chat_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_my_chats_order: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  sort_my_chats_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_queue_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_queue_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_chatbot_order: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  sort_chatbot_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListChatsUserResponse = Static<typeof listChatsUserResponseSchema>;
