import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { useChatNotificationToast } from './useChatNotificationToast';
import axiosAuth from '@/@webcore/axios';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';

const MAX_LINE_LENGTH = 70;
const VAPID_PUBLIC_KEY_CACHE_TTL_MS = 30 * 60 * 1000;

let cachedVapidPublicKey: string | null = null;
let cachedVapidPublicKeyExpiresAt = 0;
let pendingVapidPublicKeyRequest: Promise<string> | null = null;

function clearCachedVapidPublicKey(): void {
  cachedVapidPublicKey = null;
  cachedVapidPublicKeyExpiresAt = 0;
}

async function getCachedVapidPublicKey(): Promise<string> {
  const now = Date.now();

  if (cachedVapidPublicKey && now < cachedVapidPublicKeyExpiresAt) {
    return cachedVapidPublicKey;
  }

  if (pendingVapidPublicKeyRequest) {
    return pendingVapidPublicKeyRequest;
  }

  pendingVapidPublicKeyRequest = (async () => {
    const response = await axiosAuth.get('/push/public-key');
    const publicKey = response?.data?.data?.public_key;

    if (typeof publicKey !== 'string' || publicKey.length === 0) {
      throw new Error('Invalid push public key response');
    }

    cachedVapidPublicKey = publicKey;
    cachedVapidPublicKeyExpiresAt = Date.now() + VAPID_PUBLIC_KEY_CACHE_TTL_MS;

    return publicKey;
  })();

  try {
    return await pendingVapidPublicKeyRequest;
  } catch (error) {
    clearCachedVapidPublicKey();
    throw error;
  } finally {
    pendingVapidPublicKeyRequest = null;
  }
}

export function formatNotificationBody(preview: string): string {
  const normalized = preview.trim().replace(/\s+/g, ' ').replace(/\n+/g, ' ');

  if (normalized.length <= MAX_LINE_LENGTH) {
    return `${normalized}\n`;
  }

  const words = normalized.split(' ');
  let line1 = '';
  let line2 = '';

  for (const word of words) {
    const testLine = line1 ? `${line1} ${word}` : word;
    if (testLine.length <= MAX_LINE_LENGTH) {
      line1 = testLine;
      continue;
    }
    break;
  }

  const remaining = normalized.substring(line1.length).trim();
  if (remaining.length <= MAX_LINE_LENGTH) {
    line2 = remaining;
  } else {
    line2 = remaining.substring(0, MAX_LINE_LENGTH - 3) + '...';
  }

  return `${line1}\n${line2}`;
}

function playAlertSound(): void {
  try {
    const audio = new Audio('/sounds/message-alert.mp3');
    audio.preload = 'auto';
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch {
    return;
  }
}

function getChatFromStore(
  message: IChatMessage,
  chatStore: ReturnType<typeof useChatStore>
) {
  return (
    chatStore.listQueue.find((c) => c.chat_id === message.chat_id) ||
    chatStore.listInChat.find((c) => c.chat_id === message.chat_id) ||
    chatStore.listChatbot.find((c) => c.chat_id === message.chat_id) ||
    null
  );
}

function getMessagePreview(message: IChatMessage, t: (key: string) => string) {
  if (!message.content) {
    return t('chat_notification_new_message');
  }

  const text = extractMessageTextFromContent(message.content);
  if (text) {
    return text;
  }

  switch (message.content.type) {
    case EMessageType.image:
      return `[${t('image')}]`;
    case EMessageType.video:
      return `[${t('video')}]`;
    case EMessageType.audio:
      return `[${t('audio')}]`;
    case EMessageType.document:
      return `[${t('document')}]`;
    case EMessageType.sticker:
      return `[${t('sticker')}]`;
    case EMessageType.location:
      return `[${t('location')}]`;
    case EMessageType.contact_card:
    case EMessageType.contacts:
      return `[${t('contact')}]`;
    default:
      return `[${t('message')}]`;
  }
}

type ChatTitleSource = {
  name: string | null;
  contact?: {
    name: string;
  } | null;
};

function getChatTitle(chat: ChatTitleSource, fallback: string): string {
  return chat.name || chat.contact?.name || fallback;
}

function isChatbotStatus(status: string): boolean {
  return (
    status === EChatStatus.ura ||
    status === EChatStatus.ura_output ||
    status === EChatStatus.ura_schedule ||
    status === EChatStatus.ura_webhook
  );
}

function canReceiveMessageNotification(
  chat: IChat,
  chatStore: ReturnType<typeof useChatStore>
): boolean {
  if (!chatStore.user?.account_id) {
    return false;
  }

  return chatStore.canViewChat(chat);
}

export const useChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const { t } = useI18n();
  const chatStore = useChatStore();
  const { showMessageToast, showStatusToast, showTransferToast } =
    useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null);
  const isSubscribing = ref(false);
  const isSyncingNotificationSettings = ref(false);
  const hasPendingNotificationSync = ref(false);

  const isMasterNotificationsEnabled = () => {
    return chatStore.user?.chat_user?.notifications === true;
  };

  const isSoundNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_sound !== false;
  };

  const isToastNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_toast !== false;
  };

  const isBrowserNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_browser !== false;
  };

  const isPushNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_push !== false;
  };

  const isStatusNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_status_update !== false;
  };

  const isQueueStatusNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_status_queue === true;
  };

  const isInChatStatusNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_status_in_chat !== false;
  };

  const isChatbotStatusNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_status_chatbot === true;
  };

  const isQueueNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_message_queue === true;
  };

  const isInChatNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_message_in_chat !== false;
  };

  const isChatbotNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_message_chatbot === true;
  };

  const isTransferNotificationsEnabled = () => {
    if (!isMasterNotificationsEnabled()) {
      return false;
    }

    return chatStore.user?.chat_user?.notifications_transfer !== false;
  };

  const isInternalChatPushNotificationsEnabled = () => {
    const chatUser = chatStore.user?.chat_user;

    return (
      chatUser?.notifications_internal_chat !== false &&
      chatUser?.notifications_internal_chat_push !== false
    );
  };

  const shouldKeepPushSubscription = () => {
    return (
      isPushNotificationsEnabled() || isInternalChatPushNotificationsEnabled()
    );
  };

  const isViewingChatConversation = (chatId: string): boolean => {
    const routeName = route.name;
    const isChatScreen = routeName === 'chat' || routeName === 'kanban';

    if (!isChatScreen) {
      return false;
    }

    return chatStore.activeChat?.chat_id === chatId;
  };

  const showBrowserNotification = (
    title: string,
    body: string,
    chatId: string,
    tag: string
  ): void => {
    if (!isBrowserNotificationsEnabled()) {
      return;
    }

    if (!('Notification' in globalThis)) {
      return;
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag,
        data: {
          chatId,
        },
      });

      notification.onclick = () => {
        notification.close();

        if (chatStore.setActiveChat) {
          chatStore.setActiveChat(chatId);
        }

        router.push({
          name: 'chat',
        });

        if (typeof globalThis.focus === 'function') {
          globalThis.focus();
        }
      };
    } catch {
      return;
    }
  };

  const getChatNotificationEvent = (
    chat: IChat
  ): { type?: string; actor_user_id?: string | null } | null => {
    const event = (
      chat as IChat & {
        notification_event?: { type?: string; actor_user_id?: string | null };
      }
    ).notification_event;

    return event ?? null;
  };

  const getSecondaryUserIds = (chat: Pick<IChat, 'secondary_users'>) => {
    if (!Array.isArray(chat.secondary_users)) {
      return '';
    }

    return chat.secondary_users
      .map((user) => user?.id)
      .filter(Boolean)
      .sort()
      .join(',');
  };

  const hasTransferRelevantChange = (
    chat: IChat,
    previousChat: IChat | null
  ): boolean => {
    if (!previousChat) {
      return false;
    }

    return (
      previousChat.worker?.id !== chat.worker?.id ||
      previousChat.sector?.id !== chat.sector?.id ||
      previousChat.user?.id !== chat.user?.id ||
      getSecondaryUserIds(previousChat) !== getSecondaryUserIds(chat)
    );
  };

  async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register(
        '/service-worker.js',
        {
          scope: '/',
        }
      );

      serviceWorkerRegistration.value = registration;
      return registration;
    } catch {
      return null;
    }
  }

  function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = globalThis.atob(base64);
    const bytes = Uint8Array.from(
      [...rawData].map((char) => char.charCodeAt(0))
    );
    return bytes.buffer;
  }

  function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
  }

  async function unsubscribeFromPushNotificationsInternal(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
      return;
    }

    try {
      let registration: ServiceWorkerRegistration | null = null;

      if (serviceWorkerRegistration.value) {
        registration = serviceWorkerRegistration.value;
      } else {
        const existingRegistration =
          await navigator.serviceWorker.getRegistration();
        if (existingRegistration) {
          registration = existingRegistration;
        } else {
          return;
        }
      }

      if (!registration) {
        return;
      }

      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        return;
      }

      const endpoint = subscription.endpoint;

      try {
        await axiosAuth.delete('/push/unsubscribe', {
          data: { endpoint },
        });
      } catch {}

      try {
        await subscription.unsubscribe();
      } catch {
        return;
      }
    } catch {
      return;
    }
  }

  async function subscribeToPushNotifications(): Promise<void> {
    if (isSubscribing.value) {
      return;
    }

    if (!isPushNotificationsEnabled()) {
      return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
      return;
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    isSubscribing.value = true;

    try {
      let registration: ServiceWorkerRegistration | null = null;

      if (serviceWorkerRegistration.value) {
        registration = serviceWorkerRegistration.value;
      } else {
        const existingRegistration =
          await navigator.serviceWorker.getRegistration();
        if (existingRegistration) {
          registration = existingRegistration;
          serviceWorkerRegistration.value = existingRegistration;
        } else {
          if (!isPushNotificationsEnabled()) {
            isSubscribing.value = false;
            return;
          }

          const newRegistration = await registerServiceWorker();
          if (newRegistration) {
            registration = newRegistration;
          } else {
            isSubscribing.value = false;
            return;
          }
        }
      }

      if (!registration) {
        isSubscribing.value = false;
        return;
      }

      if (!isPushNotificationsEnabled()) {
        isSubscribing.value = false;
        if (!shouldKeepPushSubscription()) {
          await unsubscribeFromPushNotificationsInternal();
        }
        return;
      }

      const existingSubscription =
        await registration.pushManager.getSubscription();

      if (existingSubscription) {
        if (!isPushNotificationsEnabled()) {
          if (!shouldKeepPushSubscription()) {
            await unsubscribeFromPushNotificationsInternal();
          }
        }
        isSubscribing.value = false;
        return;
      }

      const publicKey = await getCachedVapidPublicKey();

      if (!isPushNotificationsEnabled()) {
        isSubscribing.value = false;
        if (!shouldKeepPushSubscription()) {
          await unsubscribeFromPushNotificationsInternal();
        }
        return;
      }

      let convertedVapidKey: ArrayBuffer;

      try {
        convertedVapidKey = urlBase64ToUint8Array(publicKey);
      } catch {
        clearCachedVapidPublicKey();
        const refreshedPublicKey = await getCachedVapidPublicKey();
        convertedVapidKey = urlBase64ToUint8Array(refreshedPublicKey);
      }

      if (!isPushNotificationsEnabled()) {
        isSubscribing.value = false;
        if (!shouldKeepPushSubscription()) {
          await unsubscribeFromPushNotificationsInternal();
        }
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      if (!isPushNotificationsEnabled()) {
        if (!shouldKeepPushSubscription()) {
          await subscription.unsubscribe().catch(() => {});
        }
        isSubscribing.value = false;
        if (!shouldKeepPushSubscription()) {
          return;
        }
      }

      const subscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
        user_agent: navigator.userAgent,
      };

      if (!isPushNotificationsEnabled()) {
        if (!shouldKeepPushSubscription()) {
          await subscription.unsubscribe().catch(() => {});
        }
        isSubscribing.value = false;
        if (!shouldKeepPushSubscription()) {
          return;
        }
      }

      await axiosAuth.post('/push/subscribe', subscriptionData);

      isSubscribing.value = false;
    } catch {
      clearCachedVapidPublicKey();
      isSubscribing.value = false;
      return;
    }
  }

  async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in globalThis)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
      } catch {
        return false;
      }
    }

    return false;
  }

  async function handleNewMessage(message: IChatMessage): Promise<void> {
    if (!isMasterNotificationsEnabled()) {
      return;
    }

    const isFromMe = message.message_key?.from_me === true;

    if (isFromMe) {
      return;
    }

    if (message.type_user === ETypeUserChat.operator) {
      return;
    }

    const chat = getChatFromStore(message, chatStore);

    if (!chat) {
      return;
    }

    if (
      chat.status !== EChatStatus.in_chat &&
      chat.status !== EChatStatus.queue &&
      !isChatbotStatus(chat.status)
    ) {
      return;
    }

    if (chat.status === EChatStatus.queue && !isQueueNotificationsEnabled()) {
      return;
    }

    if (
      chat.status === EChatStatus.in_chat &&
      !isInChatNotificationsEnabled()
    ) {
      return;
    }

    if (isChatbotStatus(chat.status) && !isChatbotNotificationsEnabled()) {
      return;
    }

    if (!canReceiveMessageNotification(chat as IChat, chatStore)) {
      return;
    }

    if (isViewingChatConversation(message.chat_id)) {
      return;
    }

    const messageKey = `${message.chat_id}-${message.message_id}`;
    if (processingMessages.value.has(messageKey)) {
      return;
    }

    processingMessages.value.add(messageKey);

    const title = getChatTitle(chat, t('chat_notification_new_message'));
    const body = formatNotificationBody(getMessagePreview(message, t));

    if (isSoundNotificationsEnabled()) {
      playAlertSound();
    }

    if (isToastNotificationsEnabled() && isPageVisible.value) {
      showMessageToast(message);
    }

    if (isBrowserNotificationsEnabled() && !isPageVisible.value) {
      showBrowserNotification(
        title,
        body,
        message.chat_id,
        `chat-browser-${message.chat_id}`
      );
    }

    setTimeout(() => {
      processingMessages.value.delete(messageKey);
    }, 5000);
  }

  function handleChatTransfer(
    chat: IChat,
    previousChat: IChat | null = null
  ): boolean {
    const event = getChatNotificationEvent(chat);
    const isTransferEvent = event?.type === 'chat_transfer';

    if (!isTransferEvent && !hasTransferRelevantChange(chat, previousChat)) {
      return false;
    }

    if (event?.actor_user_id === chatStore.user?.user_id) {
      return true;
    }

    if (!isTransferNotificationsEnabled()) {
      return true;
    }

    if (!canReceiveMessageNotification(chat, chatStore)) {
      return true;
    }

    if (isViewingChatConversation(chat.chat_id)) {
      return true;
    }

    const title = getChatTitle(chat, t('chat_notification_transfer'));
    const body = formatNotificationBody(
      t('chat_notification_transfer_received')
    );

    if (isSoundNotificationsEnabled()) {
      playAlertSound();
    }

    if (isToastNotificationsEnabled() && isPageVisible.value) {
      showTransferToast(chat);
    }

    if (isBrowserNotificationsEnabled() && !isPageVisible.value) {
      showBrowserNotification(
        title,
        body,
        chat.chat_id,
        `chat-transfer-browser-${chat.chat_id}`
      );
    }

    return true;
  }

  function handleChatStatusChange(
    chat: IChat,
    previousStatus: string | null = null
  ): void {
    if (
      chat.status !== EChatStatus.in_chat &&
      chat.status !== EChatStatus.queue &&
      !isChatbotStatus(chat.status)
    ) {
      return;
    }

    if (previousStatus === chat.status) {
      return;
    }

    const shouldNotifyQueueStatus =
      isStatusNotificationsEnabled() && isQueueStatusNotificationsEnabled();
    const shouldNotifyInChatStatus =
      isStatusNotificationsEnabled() && isInChatStatusNotificationsEnabled();
    const shouldNotifyChatbotStatus =
      isStatusNotificationsEnabled() && isChatbotStatusNotificationsEnabled();

    if (chat.status === EChatStatus.queue && !shouldNotifyQueueStatus) {
      return;
    }

    if (chat.status === EChatStatus.in_chat && !shouldNotifyInChatStatus) {
      return;
    }

    if (isChatbotStatus(chat.status) && !shouldNotifyChatbotStatus) {
      return;
    }

    if (!canReceiveMessageNotification(chat, chatStore)) {
      return;
    }

    if (isViewingChatConversation(chat.chat_id)) {
      return;
    }

    const statusBody =
      chat.status === EChatStatus.in_chat
        ? t('chat_notification_status_in_chat')
        : chat.status === EChatStatus.queue
          ? t('chat_notification_status_queue')
          : t('chat_notification_status_chatbot');

    if (isSoundNotificationsEnabled()) {
      playAlertSound();
    }

    if (isToastNotificationsEnabled() && isPageVisible.value) {
      showStatusToast(chat);
    }

    if (isBrowserNotificationsEnabled() && !isPageVisible.value) {
      showBrowserNotification(
        getChatTitle(chat, t('chat_notification_status_update')),
        statusBody,
        chat.chat_id,
        `chat-status-browser-${chat.chat_id}`
      );
    }
  }

  function handleVisibilityChange() {
    isPageVisible.value = !document.hidden;
  }

  async function syncNotificationSettings(): Promise<void> {
    const shouldUseBrowserNotifications = isBrowserNotificationsEnabled();
    const shouldUsePushNotifications = isPushNotificationsEnabled();

    if (!('Notification' in globalThis)) {
      if (!shouldKeepPushSubscription()) {
        await unsubscribeFromPushNotificationsInternal();
      }
      return;
    }

    if (shouldUseBrowserNotifications || shouldUsePushNotifications) {
      if (Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    }

    if (!shouldUsePushNotifications) {
      if (!shouldKeepPushSubscription()) {
        await unsubscribeFromPushNotificationsInternal();
      }
      return;
    }

    if (
      shouldUsePushNotifications &&
      'serviceWorker' in navigator &&
      !serviceWorkerRegistration.value
    ) {
      await registerServiceWorker();
    }

    if (Notification.permission === 'granted') {
      await subscribeToPushNotifications();
      return;
    }

    if (!shouldKeepPushSubscription()) {
      await unsubscribeFromPushNotificationsInternal();
    }
  }

  async function runNotificationSettingsSync(): Promise<void> {
    if (isSyncingNotificationSettings.value) {
      hasPendingNotificationSync.value = true;
      return;
    }

    isSyncingNotificationSettings.value = true;

    try {
      do {
        hasPendingNotificationSync.value = false;
        await syncNotificationSettings();
      } while (hasPendingNotificationSync.value);
    } finally {
      isSyncingNotificationSettings.value = false;
    }
  }

  onMounted(async () => {
    isPageVisible.value = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ('serviceWorker' in navigator) {
      if (isPushNotificationsEnabled()) {
        await registerServiceWorker();
      }

      const handleServiceWorkerMessage = (event: Event) => {
        const messageEvent = event as MessageEvent;
        if (
          messageEvent.data?.type === 'navigateToChat' &&
          messageEvent.data?.chatId
        ) {
          if (chatStore.setActiveChat) {
            chatStore.setActiveChat(messageEvent.data.chatId);
          }
          router.push({
            name: 'chat',
          });
        }
      };

      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.addEventListener(
          'message',
          handleServiceWorkerMessage as EventListener
        );
      }

      navigator.serviceWorker.addEventListener(
        'message',
        handleServiceWorkerMessage as EventListener
      );
    }
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  watch(
    () => [
      chatStore.user?.chat_user?.notifications,
      chatStore.user?.chat_user?.notifications_sound,
      chatStore.user?.chat_user?.notifications_toast,
      chatStore.user?.chat_user?.notifications_push,
      chatStore.user?.chat_user?.notifications_browser,
      chatStore.user?.chat_user?.notifications_status_update,
      chatStore.user?.chat_user?.notifications_status_queue,
      chatStore.user?.chat_user?.notifications_status_in_chat,
      chatStore.user?.chat_user?.notifications_status_chatbot,
      chatStore.user?.chat_user?.notifications_message_queue,
      chatStore.user?.chat_user?.notifications_message_in_chat,
      chatStore.user?.chat_user?.notifications_message_chatbot,
      chatStore.user?.chat_user?.notifications_transfer,
      chatStore.user?.chat_user?.notifications_internal_chat,
      chatStore.user?.chat_user?.notifications_internal_chat_push,
    ],
    async () => {
      await runNotificationSettingsSync();
    },
    { immediate: true }
  );

  return {
    handleNewMessage,
    handleChatStatusChange,
    handleChatTransfer,
    requestNotificationPermission,
    registerServiceWorker,
    unsubscribeFromPushNotifications: unsubscribeFromPushNotificationsInternal,
  };
};

export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();

    if (!registration) {
      return;
    }

    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      return;
    }

    const endpoint = subscription.endpoint;

    try {
      await axiosAuth.delete('/push/unsubscribe', {
        data: { endpoint },
      });
    } catch {}

    try {
      await subscription.unsubscribe();
    } catch {
      return;
    }
  } catch {
    return;
  }
}
