import { Static, Type } from '@sinclair/typebox';

export const internalChatNotificationSettingsDataSchema = Type.Object({
  chat_user_id: Type.String({ format: 'uuid' }),
  notifications_internal_chat: Type.Boolean(),
  notifications_internal_chat_direct: Type.Boolean(),
  notifications_internal_chat_group: Type.Boolean(),
  notifications_internal_chat_sound: Type.Boolean(),
  notifications_internal_chat_toast: Type.Boolean(),
  notifications_internal_chat_browser: Type.Boolean(),
  notifications_internal_chat_push: Type.Boolean(),
});

export const internalChatNotificationSettingsResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatNotificationSettingsDataSchema,
});

export type InternalChatNotificationSettingsResponse = Static<
  typeof internalChatNotificationSettingsResponseSchema
>;
export type InternalChatNotificationSettingsData = Static<
  typeof internalChatNotificationSettingsDataSchema
>;
