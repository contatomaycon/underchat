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
  const { showMessageToast, showStatusToast } = useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null);
  const isSubscribing = ref(false);

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

    return chatStore.user?.chat_user?.notifications_status_chatbot !== false;
  };

  const isQueueNotificationsEnabled = () => {
    return isQueueStatusNotificationsEnabled();
  };

  const isInChatNotificationsEnabled = () => {
    return isInChatStatusNotificationsEnabled();
  };

  const isChatbotNotificationsEnabled = () => {
    return isChatbotStatusNotificationsEnabled();
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
        await unsubscribeFromPushNotificationsInternal();
        return;
      }

      const response = await axiosAuth.get('/push/public-key');

      if (!isPushNotificationsEnabled()) {
        isSubscribing.value = false;
        await unsubscribeFromPushNotificationsInternal();
        return;
      }

      const { public_key } = response.data.data;

      const existingSubscription =
        await registration.pushManager.getSubscription();

      if (existingSubscription) {
        if (!isPushNotificationsEnabled()) {
          await unsubscribeFromPushNotificationsInternal();
        }
        isSubscribing.value = false;
        return;
      }

      const convertedVapidKey = urlBase64ToUint8Array(public_key);

      if (!isPushNotificationsEnabled()) {
        isSubscribing.value = false;
        await unsubscribeFromPushNotificationsInternal();
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      if (!isPushNotificationsEnabled()) {
        await subscription.unsubscribe().catch(() => {});
        isSubscribing.value = false;
        return;
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
        await subscription.unsubscribe().catch(() => {});
        isSubscribing.value = false;
        return;
      }

      await axiosAuth.post('/push/subscribe', subscriptionData);

      isSubscribing.value = false;
    } catch {
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

  function handleChatStatusChange(
    chat: IChat,
    previousStatus: string | null = null
  ): void {
    if (
      chat.status !== EChatStatus.in_chat &&
      chat.status !== EChatStatus.queue
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

    if (chat.status === EChatStatus.queue && !shouldNotifyQueueStatus) {
      return;
    }

    if (chat.status === EChatStatus.in_chat && !shouldNotifyInChatStatus) {
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
        : t('chat_notification_status_queue');

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
      await unsubscribeFromPushNotificationsInternal();
      return;
    }

    if (shouldUseBrowserNotifications || shouldUsePushNotifications) {
      if (Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    }

    if (!shouldUsePushNotifications) {
      await unsubscribeFromPushNotificationsInternal();
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

    await unsubscribeFromPushNotificationsInternal();
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
      chatStore.user?.chat_user?.notifications_push,
      chatStore.user?.chat_user?.notifications_browser,
      chatStore.user?.chat_user?.notifications_status_chatbot,
    ],
    async () => {
      await syncNotificationSettings();
    },
    { immediate: true }
  );

  return {
    handleNewMessage,
    handleChatStatusChange,
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
