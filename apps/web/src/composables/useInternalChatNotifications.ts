import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axiosAuth from '@/@webcore/axios';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { useChatNotificationToast } from '@/composables/useChatNotificationToast';
import { formatNotificationBody } from '@/composables/useChatNotifications';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';

type InternalMessage = ListMessagesResponse['data']['results'][number];

const VAPID_PUBLIC_KEY_CACHE_TTL_MS = 30 * 60 * 1000;

let activeMessageHandler: ((message: InternalMessage) => void) | null = null;
let cachedVapidPublicKey: string | null = null;
let cachedVapidPublicKeyExpiresAt = 0;
let pendingVapidPublicKeyRequest: Promise<string> | null = null;

export function emitInternalChatNotificationMessage(
  message: InternalMessage
): void {
  activeMessageHandler?.(message);
}

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

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = globalThis.atob(base64);
  const bytes = Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
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

export const useInternalChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const { t } = useI18n();
  const internalChatStore = useInternalChatStore();
  const { showInternalMessageToast } = useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null);
  const isSubscribing = ref(false);
  const isSyncingNotificationSettings = ref(false);
  const hasPendingNotificationSync = ref(false);
  let serviceWorkerMessageHandler: EventListener | null = null;

  const getChatUser = () => internalChatStore.user?.chat_user ?? null;

  const isMasterNotificationsEnabled = () => {
    const chatUser = getChatUser();
    return chatUser?.notifications_internal_chat !== false;
  };

  const isSoundNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_sound !== false;

  const isToastNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_toast !== false;

  const isBrowserNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_browser !== false;

  const isPushNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_push !== false;

  const isDirectNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_direct !== false;

  const isGroupNotificationsEnabled = () =>
    isMasterNotificationsEnabled() &&
    getChatUser()?.notifications_internal_chat_group !== false;

  const resolveConversation = (conversationId: string) => {
    return internalChatStore.activeConversation?.conversation_id ===
      conversationId
      ? internalChatStore.activeConversation
      : internalChatStore.conversations.find(
          (item) => item.conversation_id === conversationId
        );
  };

  const canReceiveByConversationType = (message: InternalMessage): boolean => {
    const conversation = resolveConversation(message.conversation_id);

    if (conversation?.type === EInternalChatConversationType.group) {
      return isGroupNotificationsEnabled();
    }

    if (conversation?.type === EInternalChatConversationType.direct) {
      return isDirectNotificationsEnabled();
    }

    return isDirectNotificationsEnabled() || isGroupNotificationsEnabled();
  };

  const isViewingInternalConversation = (conversationId: string): boolean => {
    if (route.name !== 'internal-chat') {
      return false;
    }

    return (
      internalChatStore.activeConversation?.conversation_id === conversationId
    );
  };

  const getMessagePreview = (message: InternalMessage): string => {
    if (message.content.type === EMessageType.text && message.content.message) {
      return message.content.message;
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
      case EMessageType.location:
        return `[${t('location')}]`;
      case EMessageType.contact_card:
      case EMessageType.contacts:
        return `[${t('contact')}]`;
      default:
        return `[${t('message')}]`;
    }
  };

  const getNotificationTitle = (message: InternalMessage): string => {
    const conversation = resolveConversation(message.conversation_id);

    if (conversation?.type === EInternalChatConversationType.group) {
      return conversation.name || t('internal_chat_default_conversation');
    }

    return message.user?.name || t('internal_chat_default_conversation');
  };

  const showBrowserNotification = (
    title: string,
    body: string,
    conversationId: string,
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
          internalChatConversationId: conversationId,
        },
      });

      notification.onclick = () => {
        notification.close();
        router.push({
          name: 'internal-chat',
          query: { conversation_id: conversationId },
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
        { scope: '/' }
      );

      serviceWorkerRegistration.value = registration;
      return registration;
    } catch {
      return null;
    }
  }

  async function subscribeToPushNotifications(): Promise<void> {
    if (isSubscribing.value || !isPushNotificationsEnabled()) {
      return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
      return;
    }

    if (
      !('Notification' in globalThis) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    isSubscribing.value = true;

    try {
      let registration =
        serviceWorkerRegistration.value ??
        (await navigator.serviceWorker.getRegistration()) ??
        (await registerServiceWorker());

      if (!registration || !isPushNotificationsEnabled()) {
        return;
      }

      serviceWorkerRegistration.value = registration;
      const existingSubscription =
        await registration.pushManager.getSubscription();

      if (existingSubscription) {
        return;
      }

      const publicKey = await getCachedVapidPublicKey();
      const convertedVapidKey = urlBase64ToUint8Array(publicKey);

      if (!isPushNotificationsEnabled()) {
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      if (!isPushNotificationsEnabled()) {
        await subscription.unsubscribe().catch(() => {});
        return;
      }

      await axiosAuth.post('/push/subscribe', {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
        user_agent: navigator.userAgent,
      });
    } catch {
      clearCachedVapidPublicKey();
    } finally {
      isSubscribing.value = false;
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

  async function handleNewMessage(message: InternalMessage): Promise<void> {
    if (!isMasterNotificationsEnabled()) {
      return;
    }

    if (message.deleted || message.content?.type === EMessageType.system) {
      return;
    }

    if (message.user?.id === internalChatStore.currentUserId) {
      return;
    }

    if (isViewingInternalConversation(message.conversation_id)) {
      return;
    }

    if (!canReceiveByConversationType(message)) {
      return;
    }

    const messageKey = `${message.conversation_id}-${message.message_id}`;
    if (processingMessages.value.has(messageKey)) {
      return;
    }

    processingMessages.value.add(messageKey);

    const title = getNotificationTitle(message);
    const body = formatNotificationBody(getMessagePreview(message));

    if (isSoundNotificationsEnabled()) {
      playAlertSound();
    }

    if (isToastNotificationsEnabled() && isPageVisible.value) {
      showInternalMessageToast(message);
    }

    if (isBrowserNotificationsEnabled() && !isPageVisible.value) {
      showBrowserNotification(
        title,
        body,
        message.conversation_id,
        `internal-chat-browser-${message.conversation_id}`
      );
    }

    setTimeout(() => {
      processingMessages.value.delete(messageKey);
    }, 5000);
  }

  function handleVisibilityChange() {
    isPageVisible.value = !document.hidden;
  }

  async function syncNotificationSettings(): Promise<void> {
    const shouldUseBrowserNotifications = isBrowserNotificationsEnabled();
    const shouldUsePushNotifications = isPushNotificationsEnabled();

    if (!('Notification' in globalThis)) {
      return;
    }

    if (shouldUseBrowserNotifications || shouldUsePushNotifications) {
      if (Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    }

    if (!shouldUsePushNotifications) {
      return;
    }

    if ('serviceWorker' in navigator && !serviceWorkerRegistration.value) {
      await registerServiceWorker();
    }

    if (Notification.permission === 'granted') {
      await subscribeToPushNotifications();
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
    activeMessageHandler = (message) => {
      void handleNewMessage(message);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ('serviceWorker' in navigator) {
      if (isPushNotificationsEnabled()) {
        await registerServiceWorker();
      }

      serviceWorkerMessageHandler = (event: Event) => {
        const messageEvent = event as MessageEvent;
        if (
          messageEvent.data?.type === 'navigateToInternalChat' &&
          messageEvent.data?.conversationId
        ) {
          const conversationId = messageEvent.data.conversationId;
          router.push({
            name: 'internal-chat',
            query: { conversation_id: conversationId },
          });
        }
      };

      navigator.serviceWorker.addEventListener(
        'message',
        serviceWorkerMessageHandler
      );
    }
  });

  onUnmounted(() => {
    if (activeMessageHandler) {
      activeMessageHandler = null;
    }
    if ('serviceWorker' in navigator && serviceWorkerMessageHandler) {
      navigator.serviceWorker.removeEventListener(
        'message',
        serviceWorkerMessageHandler
      );
      serviceWorkerMessageHandler = null;
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  watch(
    [
      () => internalChatStore.user?.chat_user?.notifications_internal_chat,
      () => internalChatStore.user?.chat_user?.notifications_internal_chat_push,
      () =>
        internalChatStore.user?.chat_user?.notifications_internal_chat_browser,
      () =>
        internalChatStore.user?.chat_user?.notifications_internal_chat_direct,
      () =>
        internalChatStore.user?.chat_user?.notifications_internal_chat_group,
    ],
    async () => {
      await runNotificationSettingsSync();
    },
    { immediate: true }
  );

  return {
    handleNewMessage,
    requestNotificationPermission,
    registerServiceWorker,
  };
};
