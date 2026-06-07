import { ref } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';

export type ChatTransferNotificationPayload = {
  id: string;
  type: 'transfer';
  chat_id: string;
  actor_user_id: string;
  actor_user_name?: string;
  contact_name: string;
  contact_photo?: string;
};

export type ChatNotificationToastPayload =
  | {
      id: string;
      type: 'message';
      message: IChatMessage;
    }
  | {
      id: string;
      type: 'status';
      chat: IChat;
    }
  | ChatTransferNotificationPayload
  | {
      id: string;
      type: 'internal-message';
      message: ListMessagesResponse['data']['results'][number];
    };

const CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY =
  'chat_transfer_notifications_v1';
const CHAT_TRANSFER_NOTIFICATIONS_TTL_MS = 24 * 60 * 60 * 1000;

type StoredTransferNotificationsState = {
  account_id: string;
  user_id: string;
  expires_at: number;
  notifications: ChatTransferNotificationPayload[];
};

const activeNotification = ref<ChatNotificationToastPayload | null>(null);
const pendingTransferNotifications = ref<ChatTransferNotificationPayload[]>([]);

function hasTransferNotificationQueueContext(
  accountId?: string,
  userId?: string
): boolean {
  return Boolean(accountId && userId);
}

function sanitizeTransferNotification(
  notification: unknown
): ChatTransferNotificationPayload | null {
  if (!notification || typeof notification !== 'object') {
    return null;
  }

  const payload = notification as Partial<ChatTransferNotificationPayload>;

  if (typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    return null;
  }

  if (payload.type !== 'transfer') {
    return null;
  }

  if (typeof payload.chat_id !== 'string' || payload.chat_id.trim().length === 0) {
    return null;
  }

  if (typeof payload.actor_user_id !== 'string') {
    return null;
  }

  if (
    typeof payload.contact_name !== 'string' ||
    payload.contact_name.trim().length === 0
  ) {
    return null;
  }

  return {
    id: payload.id,
    type: 'transfer',
    chat_id: payload.chat_id,
    actor_user_id: payload.actor_user_id,
    actor_user_name: payload.actor_user_name,
    contact_name: payload.contact_name,
    contact_photo: payload.contact_photo,
  };
}

function parseStoredTransferNotifications(
  raw: string | null,
  accountId?: string,
  userId?: string
): ChatTransferNotificationPayload[] {
  if (!raw || !hasTransferNotificationQueueContext(accountId, userId)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    return [];
  }

  if (!parsed || typeof parsed !== 'object') {
    localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    return [];
  }

  const data = parsed as Partial<StoredTransferNotificationsState>;

  if (
    data.account_id !== accountId ||
    data.user_id !== userId ||
    typeof data.expires_at !== 'number' ||
    data.expires_at <= Date.now()
  ) {
    localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    return [];
  }

  if (!Array.isArray(data.notifications)) {
    localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    return [];
  }

  return data.notifications
    .map((notification) => sanitizeTransferNotification(notification))
    .filter(
      (notification): notification is ChatTransferNotificationPayload =>
        notification !== null
    );
}

function readTransferNotificationsFromStorage(
  accountId?: string,
  userId?: string
): ChatTransferNotificationPayload[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  return parseStoredTransferNotifications(
    localStorage.getItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY),
    accountId,
    userId
  );
}

function persistTransferNotificationsInStorage(
  accountId?: string,
  userId?: string,
  notifications: ChatTransferNotificationPayload[] = []
) {
  if (typeof localStorage === 'undefined' || !accountId || !userId) {
    return;
  }

  if (notifications.length === 0) {
    localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    return;
  }

  const payload: StoredTransferNotificationsState = {
    account_id: accountId,
    user_id: userId,
    expires_at: Date.now() + CHAT_TRANSFER_NOTIFICATIONS_TTL_MS,
    notifications,
  };

  localStorage.setItem(
    CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY,
    JSON.stringify(payload)
  );
}

function updateTransferPersistence(
  chatStore: ReturnType<typeof useChatStore>,
  notifications: ChatTransferNotificationPayload[]
) {
  const accountId = chatStore.user?.account_id;
  const userId = chatStore.user?.user_id;

  persistTransferNotificationsInStorage(accountId, userId, notifications);
}

function showCurrentTransferNotification() {
  if (pendingTransferNotifications.value.length === 0) {
    return;
  }

  activeNotification.value = pendingTransferNotifications.value[0];
}

function removeFirstTransferNotification(
  chatStore: ReturnType<typeof useChatStore>
): void {
  if (pendingTransferNotifications.value.length === 0) {
    if (activeNotification.value?.type === 'transfer') {
      activeNotification.value = null;
    }

    updateTransferPersistence(chatStore, []);
    return;
  }

  pendingTransferNotifications.value = pendingTransferNotifications.value.slice(1);

  if (pendingTransferNotifications.value.length > 0) {
    showCurrentTransferNotification();
  } else if (activeNotification.value?.type === 'transfer') {
    activeNotification.value = null;
  }

  updateTransferPersistence(chatStore, pendingTransferNotifications.value);
}

function removeTransferNotificationById(
  chatStore: ReturnType<typeof useChatStore>,
  notificationId: string
): void {
  const nextNotifications = pendingTransferNotifications.value.filter(
    (notification) => notification.id !== notificationId
  );

  if (nextNotifications.length === pendingTransferNotifications.value.length) {
    return;
  }

  pendingTransferNotifications.value = nextNotifications;

  if (nextNotifications.length > 0) {
    showCurrentTransferNotification();
  } else if (activeNotification.value?.type === 'transfer') {
    activeNotification.value = null;
  }

  updateTransferPersistence(chatStore, nextNotifications);
}

function enqueueTransferNotification(
  payload: ChatTransferNotificationPayload
): void {
  const exists = pendingTransferNotifications.value.some(
    (notification) => notification.id === payload.id
  );

  if (!exists) {
    pendingTransferNotifications.value.push(payload);
  }

  if (activeNotification.value?.type !== 'transfer') {
    showCurrentTransferNotification();
  }
}

export function useChatNotificationToast() {
  const chatStore = useChatStore();

  function showMessageToast(message: IChatMessage) {
    if (pendingTransferNotifications.value.length > 0) {
      return;
    }

    activeNotification.value = {
      id: message.message_id,
      type: 'message',
      message,
    };
  }

  function showStatusToast(chat: IChat) {
    if (pendingTransferNotifications.value.length > 0) {
      return;
    }

    activeNotification.value = {
      id: `${chat.chat_id}-${chat.status}`,
      type: 'status',
      chat,
    };
  }

  function showTransferToast(payload: ChatTransferNotificationPayload) {
    const transferPayload: ChatTransferNotificationPayload = {
      id: payload.id || `transfer-${payload.chat_id}-${payload.actor_user_id || 'system'}`,
      type: 'transfer',
      chat_id: payload.chat_id,
      actor_user_id: payload.actor_user_id || '',
      actor_user_name: payload.actor_user_name,
      contact_name: payload.contact_name,
      contact_photo: payload.contact_photo,
    };

    enqueueTransferNotification(transferPayload);
    showCurrentTransferNotification();
    updateTransferPersistence(chatStore, pendingTransferNotifications.value);
  }

  function showInternalMessageToast(
    message: ListMessagesResponse['data']['results'][number]
  ) {
    if (pendingTransferNotifications.value.length > 0) {
      return;
    }

    activeNotification.value = {
      id: `internal-${message.message_id}`,
      type: 'internal-message',
      message,
    };
  }

  function hideToast() {
    if (activeNotification.value?.type === 'transfer') {
      removeFirstTransferNotification(chatStore);
      return;
    }

    activeNotification.value = null;
  }

  function restorePendingTransferNotifications() {
    const accountId = chatStore.user?.account_id;
    const userId = chatStore.user?.user_id;

    const notifications = readTransferNotificationsFromStorage(accountId, userId);
    pendingTransferNotifications.value = notifications;

    if (notifications.length > 0) {
      showCurrentTransferNotification();
    } else if (activeNotification.value?.type === 'transfer') {
      activeNotification.value = null;
    }
  }

  function consumeCurrentTransferNotification() {
    removeFirstTransferNotification(chatStore);
  }

  function consumeTransferNotificationById(notificationId: string) {
    removeTransferNotificationById(chatStore, notificationId);
  }

  function clearTransferPersistence() {
    pendingTransferNotifications.value = [];
    if (activeNotification.value?.type === 'transfer') {
      activeNotification.value = null;
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHAT_TRANSFER_NOTIFICATIONS_STORAGE_KEY);
    }
  }

  return {
    activeNotification,
    pendingTransferNotifications,
    showMessageToast,
    showStatusToast,
    showTransferToast,
    showInternalMessageToast,
    hideToast,
    restorePendingTransferNotifications,
    consumeCurrentTransferNotification,
    consumeTransferNotificationById,
    clearTransferPersistence,
  };
}
