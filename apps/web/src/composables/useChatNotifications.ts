import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import { getPermissions, getSectors } from '@/@webcore/localStorage/user';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
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

function canReceiveMessageNotification(
  chat: IChat,
  chatStore: ReturnType<typeof useChatStore>
): boolean {
  if (!chatStore.user?.account_id) {
    return false;
  }

  const permissions = getPermissions();
  const canListAllChatsWithoutSectorLimit = permissions.some(
    (perm: EPermissionsRoles) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.list_all_chats_without_sector_limit
  );

  const userSectors: string[] = canListAllChatsWithoutSectorLimit
    ? []
    : getSectors();

  if (canListAllChatsWithoutSectorLimit) {
    return true;
  }

  const chatExistsInList =
    chatStore.listQueue.some((c) => c.chat_id === chat.chat_id) ||
    chatStore.listInChat.some((c) => c.chat_id === chat.chat_id);

  if (chatExistsInList) {
    return true;
  }

  if (chat.user?.id === chatStore.user?.user_id) {
    return true;
  }

  if (chat.status === EChatStatus.queue && !chat.sector?.id && !chat.user?.id) {
    return true;
  }

  if (userSectors.length === 0) {
    return !chat.sector?.id;
  }

  if (!chat.sector?.id) {
    return false;
  }

  return userSectors.includes(chat.sector.id);
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
  const notifiedQueueChats = ref(new Set<string>());

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
