import { Static, Type } from '@sinclair/typebox';

export const internalChatNotificationSettingsRequestSchema = Type.Object({
  notifications_internal_chat: Type.Optional(Type.Boolean()),
  notifications_internal_chat_direct: Type.Optional(Type.Boolean()),
  notifications_internal_chat_group: Type.Optional(Type.Boolean()),
  notifications_internal_chat_sound: Type.Optional(Type.Boolean()),
  notifications_internal_chat_toast: Type.Optional(Type.Boolean()),
  notifications_internal_chat_browser: Type.Optional(Type.Boolean()),
  notifications_internal_chat_push: Type.Optional(Type.Boolean()),
});

export type InternalChatNotificationSettingsRequest = Static<
  typeof internalChatNotificationSettingsRequestSchema
>;
