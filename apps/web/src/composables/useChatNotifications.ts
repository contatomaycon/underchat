import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { useChatNotificationToast } from './useChatNotificationToast';

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

function getMessagePreview(
  message: IChatMessage,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (!message.content) {
    return `[${t('message')}]`;
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

function getSenderName(
  message: IChatMessage,
  chatStore: ReturnType<typeof useChatStore>,
  t: ReturnType<typeof useI18n>['t']
): string {
  const chat = getChatFromStore(message, chatStore);
  if (chat?.name) {
    return chat.name;
  }
  return t('unknown');
}

function getSenderIcon(
  message: IChatMessage,
  chatStore: ReturnType<typeof useChatStore>
): string {
  const chat = getChatFromStore(message, chatStore);
  if (chat?.photo) {
    return chat.photo;
  }

  return '/images/svg/avatar-default.svg';
}

async function preloadImage(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(undefined);
      return;
    }

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      resolve(url);
      return;
    }

    let finalUrl = url;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.startsWith('/')) {
        const baseUrl = window.location.origin;
        finalUrl = `${baseUrl}${finalUrl}`;
      } else {
        resolve(undefined);
        return;
      }
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      resolve(undefined);
    }, 3000);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(finalUrl);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(undefined);
    };

    img.src = finalUrl;
  });
}

export const useChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const chatStore = useChatStore();
  const { t } = useI18n();
  const { showToast } = useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());

  async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
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

  async function showNotification(message: IChatMessage): Promise<void> {
    if (!('Notification' in window)) {
      return;
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    const tag = `chat-${message.chat_id}-${message.message_id}`;

    const title = getSenderName(message, chatStore, t);
    const preview = getMessagePreview(message, t);
    const body = formatNotificationBody(preview);
    const iconUrl = getSenderIcon(message, chatStore);

    const icon = await preloadImage(iconUrl);

    const notificationOptions: NotificationOptions = {
      body,
      tag,
      requireInteraction: false,
    };

    if (icon) {
      notificationOptions.icon = icon;
      notificationOptions.badge = icon;
    }

    const notification = new Notification(title, notificationOptions);

    notification.onclick = () => {
      window.focus();
      notification.close();

      if (chatStore.setActiveChat) {
        chatStore.setActiveChat(message.chat_id);
      }

      router.push({
        name: 'chat',
      });
    };
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

    if (!chat || chat.status !== EChatStatus.in_chat) {
      return;
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

    const hasPermission = await requestNotificationPermission();
    if (hasPermission) {
      await showNotification(message);
    }

    setTimeout(() => {
      processingMessages.value.delete(messageKey);
    }, 5000);
  }

  function handleVisibilityChange() {
    isPageVisible.value = !document.hidden;
  }

  onMounted(() => {
    isPageVisible.value = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  watch(
    () => chatStore.user?.chat_user?.notifications,
    async (notifications) => {
      if (notifications === true && Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    },
    { immediate: true }
  );

  return {
    handleNewMessage,
    requestNotificationPermission,
  };
};
