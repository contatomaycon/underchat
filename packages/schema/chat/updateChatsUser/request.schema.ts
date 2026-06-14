import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateChatsUserRequestSchema = Type.Object({
  about: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.String({ enum: Object.values(EChatUserStatus) })),
  notifications: Type.Boolean(),
  notifications_sound: Type.Optional(Type.Boolean()),
  notifications_toast: Type.Optional(Type.Boolean()),
  notifications_browser: Type.Optional(Type.Boolean()),
  notifications_push: Type.Optional(Type.Boolean()),
  notifications_message_queue: Type.Optional(Type.Boolean()),
  notifications_message_in_chat: Type.Optional(Type.Boolean()),
  notifications_message_chatbot: Type.Optional(Type.Boolean()),
  notifications_transfer: Type.Optional(Type.Boolean()),
  notifications_internal_chat: Type.Optional(Type.Boolean()),
  notifications_internal_chat_direct: Type.Optional(Type.Boolean()),
  notifications_internal_chat_group: Type.Optional(Type.Boolean()),
  notifications_internal_chat_sound: Type.Optional(Type.Boolean()),
  notifications_internal_chat_toast: Type.Optional(Type.Boolean()),
  notifications_internal_chat_browser: Type.Optional(Type.Boolean()),
  notifications_internal_chat_push: Type.Optional(Type.Boolean()),
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

export type UpdateChatsUserRequest = Static<
  typeof updateChatsUserRequestSchema
>;
