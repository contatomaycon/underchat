import { Static, Type } from '@sinclair/typebox';

export const chatNotificationSettingsDataSchema = Type.Object({
  chat_user_id: Type.String({ format: 'uuid' }),
  notifications: Type.Boolean(),
  notifications_sound: Type.Boolean(),
  notifications_toast: Type.Boolean(),
  notifications_browser: Type.Boolean(),
  notifications_push: Type.Boolean(),
  notifications_message_queue: Type.Boolean(),
  notifications_message_in_chat: Type.Boolean(),
  notifications_message_chatbot: Type.Boolean(),
  notifications_transfer: Type.Boolean(),
});

export const chatNotificationSettingsResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: chatNotificationSettingsDataSchema,
});

export type ChatNotificationSettingsResponse = Static<
  typeof chatNotificationSettingsResponseSchema
>;
export type ChatNotificationSettingsData = Static<
  typeof chatNotificationSettingsDataSchema
>;
