import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateChatsUserRequestSchema = Type.Object({
  about: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.String({ enum: Object.values(EChatUserStatus) })),
  notifications: Type.Boolean(),
  filter_label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  sort_in_chat_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_my_chats_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_queue_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_chatbot_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateChatsUserRequest = Static<
  typeof updateChatsUserRequestSchema
>;
