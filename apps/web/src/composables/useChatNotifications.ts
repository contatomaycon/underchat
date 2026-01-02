import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
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

function getSenderName(
  message: IChatMessage,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (message.user?.name) {
    return message.user.name;
  }
  if (message.phone) {
    return message.phone;
  }
  return t('unknown');
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

function getSenderIcon(
  message: IChatMessage,
  chatStore: ReturnType<typeof useChatStore>
): string {
  if (message.user?.photo) {
    return message.user.photo;
  }

  const chat = getChatFromStore(message, chatStore);

  if (chat?.contact?.photo) {
    return chat.contact.photo;
  }

  if (chat?.photo) {
    return chat.photo;
  }

  return '/images/svg/avatar-default.svg';
}

async function preloadImage(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (!url || url.startsWith('data:')) {
      resolve(url);
      return;
    }

    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(url);
    img.src = url;

    setTimeout(() => resolve(url), 2000);
  });
}

export const useChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const chatStore = useChatStore();
  const { t } = useI18n();

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

    const title = getSenderName(message, t);
    const preview = getMessagePreview(message, t);
    const body = formatNotificationBody(preview);
    const iconUrl = getSenderIcon(message, chatStore);

    const icon = await preloadImage(iconUrl);

    const notification = new Notification(title, {
      body,
      icon,
      badge: icon,
      tag: `chat-${message.chat_id}`,
      requireInteraction: false,
    });

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

    playAlertSound();

    const hasPermission = await requestNotificationPermission();
    if (hasPermission) {
      await showNotification(message);
    }
  }

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
