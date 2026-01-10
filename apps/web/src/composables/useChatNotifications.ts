import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@/@webcore/stores/chat';
import { getPermissions, getSectors } from '@/@webcore/localStorage/user';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { useChatNotificationToast } from './useChatNotificationToast';
import axiosAuth from '@/@webcore/axios';

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

function canReceiveMessageNotification(
  chat: IChat,
  chatStore: ReturnType<typeof useChatStore>
): boolean {
  if (!chatStore.user?.account_id) {
    return false;
  }

  const permissions = getPermissions();
  const canViewOthersChats = permissions.some(
    (perm: EPermissionsRoles) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.view_others_chats
  );
  const canListAllChatsWithoutSectorLimit = permissions.some(
    (perm: EPermissionsRoles) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.list_all_chats_without_sector_limit
  );

  const hasPermissionToViewAll =
    canViewOthersChats || canListAllChatsWithoutSectorLimit;

  if (chat.status === EChatStatus.in_chat) {
    return hasPermissionToViewAll || chat.user?.id === chatStore.user?.user_id;
  }

  if (hasPermissionToViewAll) {
    return true;
  }

  if (chat.status === EChatStatus.queue) {
    if (chat.user?.id) {
      return chat.user.id === chatStore.user?.user_id;
    }

    const userSectors = getSectors();

    if (userSectors.length > 0) {
      if (!chat.sector?.id) {
        return false;
      }
      return userSectors.includes(chat.sector.id);
    }

    return !chat.sector?.id;
  }

  return false;
}

export const useChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const chatStore = useChatStore();
  const { showToast } = useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());
  const notifiedQueueChats = ref(new Set<string>());
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null);
  const isSubscribing = ref(false);

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

  async function subscribeToPushNotifications(): Promise<void> {
    if (isSubscribing.value) {
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

      const response = await axiosAuth.get('/push/public-key');

      const { public_key } = response.data.data;

      const convertedVapidKey = urlBase64ToUint8Array(public_key);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      const subscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
        user_agent: navigator.userAgent,
      };

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
    if (!chatStore.user?.chat_user?.notifications) {
      return;
    }

    if (route.name === 'chat') {
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
      chat.status !== EChatStatus.queue
    ) {
      return;
    }

    if (!canReceiveMessageNotification(chat as IChat, chatStore)) {
      return;
    }

    if (chat.status === EChatStatus.in_chat) {
      notifiedQueueChats.value.delete(message.chat_id);
    }

    if (chat.status === EChatStatus.queue) {
      if (notifiedQueueChats.value.has(message.chat_id)) {
        return;
      }
      notifiedQueueChats.value.add(message.chat_id);
    }

    const messageKey = `${message.chat_id}-${message.message_id}`;
    if (processingMessages.value.has(messageKey)) {
      return;
    }

    processingMessages.value.add(messageKey);

    playAlertSound();

    if (isPageVisible.value) {
      showToast(message);
    }

    setTimeout(() => {
      processingMessages.value.delete(messageKey);
    }, 5000);
  }

  function handleVisibilityChange() {
    isPageVisible.value = !document.hidden;
  }

  onMounted(async () => {
    isPageVisible.value = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ('serviceWorker' in navigator) {
      await registerServiceWorker();

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

    if (chatStore.user?.chat_user?.notifications === true) {
      if (Notification.permission === 'default') {
        await requestNotificationPermission();
      }

      if (Notification.permission === 'granted') {
        if ('serviceWorker' in navigator && !serviceWorkerRegistration.value) {
          await registerServiceWorker();
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await subscribeToPushNotifications();
      }
    }
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  watch(
    () => chatStore.user?.chat_user?.notifications,
    async (notifications) => {
      if (notifications === true) {
        if (Notification.permission === 'default') {
          await requestNotificationPermission();
        }

        if ('serviceWorker' in navigator && !serviceWorkerRegistration.value) {
          await registerServiceWorker();
        }

        if (Notification.permission === 'granted') {
          await subscribeToPushNotifications();
        }
      }
    },
    { immediate: true }
  );

  return {
    handleNewMessage,
    requestNotificationPermission,
    registerServiceWorker,
  };
};
