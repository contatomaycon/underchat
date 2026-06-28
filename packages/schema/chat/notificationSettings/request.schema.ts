import { Static, Type } from '@sinclair/typebox';

export const chatNotificationSettingsRequestSchema = Type.Object({
  notifications: Type.Optional(Type.Boolean()),
  notifications_sound: Type.Optional(Type.Boolean()),
  notifications_vibrate: Type.Optional(Type.Boolean()),
  notifications_toast: Type.Optional(Type.Boolean()),
  notifications_browser: Type.Optional(Type.Boolean()),
  notifications_push: Type.Optional(Type.Boolean()),
  notifications_message_queue: Type.Optional(Type.Boolean()),
  notifications_message_in_chat: Type.Optional(Type.Boolean()),
  notifications_message_chatbot: Type.Optional(Type.Boolean()),
  notifications_transfer: Type.Optional(Type.Boolean()),
});

export type ChatNotificationSettingsRequest = Static<
  typeof chatNotificationSettingsRequestSchema
>;
