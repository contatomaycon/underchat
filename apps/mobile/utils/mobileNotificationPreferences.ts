import type {
  ChatNotificationSettings,
  ChatNotificationSettingsPayload,
} from '../api/chatApi';
import type { EChatStatus } from '../types/chat';
import {
  INTERNAL_CHAT_CONVERSATION_TYPE,
  type InternalChatConversationType,
  type InternalChatNotificationSettings,
  type InternalChatNotificationSettingsPayload,
} from '../types/internalChat';

export const DEFAULT_MOBILE_CHAT_NOTIFICATION_SETTINGS: ChatNotificationSettings =
  {
    notifications: true,
    notifications_sound: true,
    notifications_toast: true,
    notifications_browser: true,
    notifications_push: true,
    notifications_status_update: true,
    notifications_status_queue: false,
    notifications_status_in_chat: true,
    notifications_status_chatbot: false,
    notifications_message_queue: false,
    notifications_message_in_chat: true,
    notifications_message_chatbot: false,
    notifications_transfer: true,
  };

export const DEFAULT_MOBILE_INTERNAL_CHAT_NOTIFICATION_SETTINGS: InternalChatNotificationSettings =
  {
    notifications_internal_chat: true,
    notifications_internal_chat_direct: true,
    notifications_internal_chat_group: true,
    notifications_internal_chat_sound: true,
    notifications_internal_chat_toast: true,
    notifications_internal_chat_browser: true,
    notifications_internal_chat_push: true,
  };

export type MobileForegroundDelivery = {
  showToast: boolean;
  playSound: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readBooleanDefaultTrue(value: unknown): boolean {
  return value !== false;
}

function readBooleanDefaultFalse(value: unknown): boolean {
  return value === true;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

export function isChatbotNotificationStatus(status: EChatStatus): boolean {
  return (
    status === 'ura' ||
    status === 'ura_output' ||
    status === 'ura_schedule' ||
    status === 'ura_webhook'
  );
}

export function isChatNotificationStatusEligible(status: EChatStatus): boolean {
  return (
    status === 'queue' ||
    status === 'in_chat' ||
    isChatbotNotificationStatus(status)
  );
}

export function normalizeMobileChatNotificationSettings(
  settings?: ChatNotificationSettingsPayload | null
): ChatNotificationSettings {
  const input = settings ?? {};

  return {
    chat_user_id: readString(input.chat_user_id),
    notifications: readBooleanDefaultTrue(input.notifications),
    notifications_sound: readBooleanDefaultTrue(input.notifications_sound),
    notifications_toast: readBooleanDefaultTrue(input.notifications_toast),
    notifications_browser: readBooleanDefaultTrue(input.notifications_browser),
    notifications_push: readBooleanDefaultTrue(input.notifications_push),
    notifications_status_update: readBooleanDefaultTrue(
      input.notifications_status_update
    ),
    notifications_status_queue: readBooleanDefaultFalse(
      input.notifications_status_queue
    ),
    notifications_status_in_chat: readBooleanDefaultTrue(
      input.notifications_status_in_chat
    ),
    notifications_status_chatbot: readBooleanDefaultFalse(
      input.notifications_status_chatbot
    ),
    notifications_message_queue: readBooleanDefaultFalse(
      input.notifications_message_queue
    ),
    notifications_message_in_chat: readBooleanDefaultTrue(
      input.notifications_message_in_chat
    ),
    notifications_message_chatbot: readBooleanDefaultFalse(
      input.notifications_message_chatbot
    ),
    notifications_transfer: readBooleanDefaultTrue(
      input.notifications_transfer
    ),
  };
}

export function readMobileChatNotificationSettingsFromUser(
  user: unknown
): ChatNotificationSettings {
  const chatUser =
    isRecord(user) && isRecord(user.chat_user) ? user.chat_user : {};

  return normalizeMobileChatNotificationSettings({
    chat_user_id: readString(chatUser.chat_user_id),
    notifications: chatUser.notifications as boolean | undefined,
    notifications_sound: chatUser.notifications_sound as boolean | undefined,
    notifications_toast: chatUser.notifications_toast as boolean | undefined,
    notifications_browser: chatUser.notifications_browser as
      | boolean
      | undefined,
    notifications_push: chatUser.notifications_push as boolean | undefined,
    notifications_status_update: chatUser.notifications_status_update as
      | boolean
      | undefined,
    notifications_status_queue: chatUser.notifications_status_queue as
      | boolean
      | undefined,
    notifications_status_in_chat: chatUser.notifications_status_in_chat as
      | boolean
      | undefined,
    notifications_status_chatbot: chatUser.notifications_status_chatbot as
      | boolean
      | undefined,
    notifications_message_queue: chatUser.notifications_message_queue as
      | boolean
      | undefined,
    notifications_message_in_chat: chatUser.notifications_message_in_chat as
      | boolean
      | undefined,
    notifications_message_chatbot: chatUser.notifications_message_chatbot as
      | boolean
      | undefined,
    notifications_transfer: chatUser.notifications_transfer as
      | boolean
      | undefined,
  });
}

export function resolveChatForegroundDelivery(
  settings: ChatNotificationSettingsPayload | null | undefined
): MobileForegroundDelivery {
  const normalized = normalizeMobileChatNotificationSettings(settings);
  const enabled = normalized.notifications !== false;

  return {
    showToast: enabled && normalized.notifications_toast !== false,
    playSound: enabled && normalized.notifications_sound !== false,
  };
}

export function shouldNotifyChatMessage(
  settings: ChatNotificationSettingsPayload | null | undefined,
  status: EChatStatus
): boolean {
  const normalized = normalizeMobileChatNotificationSettings(settings);
  if (normalized.notifications === false) return false;

  if (status === 'queue') {
    return normalized.notifications_message_queue === true;
  }

  if (status === 'in_chat') {
    return normalized.notifications_message_in_chat !== false;
  }

  if (isChatbotNotificationStatus(status)) {
    return normalized.notifications_message_chatbot === true;
  }

  return false;
}

export function shouldNotifyChatStatusChange(
  settings: ChatNotificationSettingsPayload | null | undefined,
  status: EChatStatus
): boolean {
  const normalized = normalizeMobileChatNotificationSettings(settings);
  if (
    normalized.notifications === false ||
    normalized.notifications_status_update === false
  ) {
    return false;
  }

  if (status === 'queue') {
    return normalized.notifications_status_queue === true;
  }

  if (status === 'in_chat') {
    return normalized.notifications_status_in_chat !== false;
  }

  if (isChatbotNotificationStatus(status)) {
    return normalized.notifications_status_chatbot === true;
  }

  return false;
}

export function shouldNotifyChatTransfer(
  settings: ChatNotificationSettingsPayload | null | undefined
): boolean {
  const normalized = normalizeMobileChatNotificationSettings(settings);
  return (
    normalized.notifications !== false &&
    normalized.notifications_transfer !== false
  );
}

export function normalizeMobileInternalChatNotificationSettings(
  settings?: InternalChatNotificationSettingsPayload | null
): InternalChatNotificationSettings {
  const input = settings ?? {};

  return {
    chat_user_id: readString(input.chat_user_id),
    notifications_internal_chat: readBooleanDefaultTrue(
      input.notifications_internal_chat
    ),
    notifications_internal_chat_direct: readBooleanDefaultTrue(
      input.notifications_internal_chat_direct
    ),
    notifications_internal_chat_group: readBooleanDefaultTrue(
      input.notifications_internal_chat_group
    ),
    notifications_internal_chat_sound: readBooleanDefaultTrue(
      input.notifications_internal_chat_sound
    ),
    notifications_internal_chat_toast: readBooleanDefaultTrue(
      input.notifications_internal_chat_toast
    ),
    notifications_internal_chat_browser: readBooleanDefaultTrue(
      input.notifications_internal_chat_browser
    ),
    notifications_internal_chat_push: readBooleanDefaultTrue(
      input.notifications_internal_chat_push
    ),
  };
}

export function readMobileInternalChatNotificationSettingsFromUser(
  user: unknown
): InternalChatNotificationSettings {
  const chatUser =
    isRecord(user) && isRecord(user.chat_user) ? user.chat_user : {};

  return normalizeMobileInternalChatNotificationSettings({
    chat_user_id: readString(chatUser.chat_user_id),
    notifications_internal_chat: chatUser.notifications_internal_chat as
      | boolean
      | undefined,
    notifications_internal_chat_direct:
      chatUser.notifications_internal_chat_direct as boolean | undefined,
    notifications_internal_chat_group:
      chatUser.notifications_internal_chat_group as boolean | undefined,
    notifications_internal_chat_sound:
      chatUser.notifications_internal_chat_sound as boolean | undefined,
    notifications_internal_chat_toast:
      chatUser.notifications_internal_chat_toast as boolean | undefined,
    notifications_internal_chat_browser:
      chatUser.notifications_internal_chat_browser as boolean | undefined,
    notifications_internal_chat_push:
      chatUser.notifications_internal_chat_push as boolean | undefined,
  });
}

export function resolveInternalChatForegroundDelivery(
  settings: InternalChatNotificationSettingsPayload | null | undefined
): MobileForegroundDelivery {
  const normalized = normalizeMobileInternalChatNotificationSettings(settings);
  const enabled = normalized.notifications_internal_chat !== false;

  return {
    showToast:
      enabled && normalized.notifications_internal_chat_toast !== false,
    playSound:
      enabled && normalized.notifications_internal_chat_sound !== false,
  };
}

export function shouldNotifyInternalChatMessage(
  settings: InternalChatNotificationSettingsPayload | null | undefined,
  conversationType: InternalChatConversationType
): boolean {
  const normalized = normalizeMobileInternalChatNotificationSettings(settings);
  if (normalized.notifications_internal_chat === false) return false;

  if (conversationType === INTERNAL_CHAT_CONVERSATION_TYPE.direct) {
    return normalized.notifications_internal_chat_direct !== false;
  }

  if (conversationType === INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return normalized.notifications_internal_chat_group !== false;
  }

  return false;
}
