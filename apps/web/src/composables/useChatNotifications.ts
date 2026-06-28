import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import { getChannels, getSectors } from '@/@webcore/localStorage/user';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { useChatNotificationToast } from './useChatNotificationToast';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import {
  postWebNotificationClientState,
  registerWebServiceWorker,
  requestWebNotificationPermission,
  syncWebPushSubscription,
  unsubscribeFromWebPushNotifications,
} from './useWebPushSubscription';

const MAX_LINE_LENGTH = 70;
const CHAT_USERS_CACHE_TTL_MS = 15 * 60 * 1000;

let cachedChatUsers: Map<string, string> | null = null;
let cachedChatUsersExpiresAt = 0;
let pendingChatUsersRequest: Promise<Map<string, string>> | null = null;

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
  const currentUserId = chatStore.user?.user_id;
  if (!chatStore.user?.account_id || !currentUserId) {
    return false;
  }

  if (!chatStore.canViewChat(chat)) {
    return false;
  }

  if (chat.status === EChatStatus.in_chat) {
    return chatStore.isCurrentUserParticipant(chat);
  }

  if (chat.status === EChatStatus.queue) {
    if (chat.user?.id) {
      return chat.user.id === currentUserId;
    }

    if (chat.sector?.id) {
      return hasCurrentUserSector(chat) && hasCurrentUserChannel(chat);
    }

    return hasCurrentUserChannel(chat);
  }

  if (isChatbotStatus(chat.status)) {
    if (chatStore.hasAnyParticipants(chat)) {
      return chatStore.isCurrentUserParticipant(chat);
    }

    if (chat.sector?.id) {
      return hasCurrentUserSector(chat) && hasCurrentUserChannel(chat);
    }

    return hasCurrentUserChannel(chat);
  }

  return false;
}

function canReceiveTransferNotification(
  chat: IChat,
  chatStore: ReturnType<typeof useChatStore>
): boolean {
  if (!chatStore.user?.user_id) {
    return false;
  }

  if (!chatStore.canViewChat(chat)) {
    return false;
  }

  if (chatStore.hasAnyParticipants(chat)) {
    return chatStore.isCurrentUserParticipant(chat);
  }

  if (chat.sector?.id) {
    return hasCurrentUserSector(chat) && hasCurrentUserChannel(chat);
  }

  return hasCurrentUserChannel(chat);
}

function hasCurrentUserChannel(chat: IChat): boolean {
  const channels = getChannels();
  if (channels.length === 0) {
    return true;
  }

  return channels.some((channel) => channel.id === chat.worker?.id);
}

function hasCurrentUserSector(chat: IChat): boolean {
  if (!chat.sector?.id) {
    return false;
  }

  return getSectors().includes(chat.sector.id);
}

export const useChatNotifications = () => {
  const route = useRoute();
  const router = useRouter();
  const { t } = useI18n();
  const chatStore = useChatStore();
  const { showMessageToast, showTransferToast } = useChatNotificationToast();
  const isPageVisible = ref(true);
  const processingMessages = ref(new Set<string>());
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null);
  const isSubscribing = ref(false);
  const isSyncingNotificationSettings = ref(false);
  const hasPendingNotificationSync = ref(false);
  let serviceWorkerMessageHandler: EventListener | null = null;
  let notificationSyncInterval: number | null = null;

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

  const postNotificationClientState = () => {
    postWebNotificationClientState({
      chatId: chatStore.activeChat?.chat_id ?? null,
      isVisible: !document.hidden,
    });
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
      previousChat.user?.id !== chat.user?.id
    );
  };

  const clearCachedChatUsers = () => {
    cachedChatUsers = null;
    cachedChatUsersExpiresAt = 0;
    pendingChatUsersRequest = null;
  };

  const getCachedChatUsers = (): Map<string, string> | null => {
    const now = Date.now();
    if (cachedChatUsers && now < cachedChatUsersExpiresAt) {
      return cachedChatUsers;
    }

    clearCachedChatUsers();
    return null;
  };

  const loadChatUsers = async (): Promise<Map<string, string>> => {
    const now = Date.now();
    const cached = getCachedChatUsers();
    if (cached) {
      return cached;
    }

    if (pendingChatUsersRequest) {
      return pendingChatUsersRequest;
    }

    pendingChatUsersRequest = (async () => {
      const response = await chatStore.listChatUsers();
      const users = response ?? [];

      const map = new Map<string, string>();
      for (const user of users) {
        if (user.user_id && user.name) {
          map.set(user.user_id, user.name);
        }
      }

      cachedChatUsers = map;
      cachedChatUsersExpiresAt = now + CHAT_USERS_CACHE_TTL_MS;

      return map;
    })();

    try {
      return await pendingChatUsersRequest;
    } catch {
      clearCachedChatUsers();
      return new Map();
    } finally {
      pendingChatUsersRequest = null;
    }
  };

  const getTransferActorName = async (
    actorUserId?: string | null
  ): Promise<string> => {
    if (!actorUserId) {
      return '';
    }

    const cachedUsers = getCachedChatUsers();
    const cachedName = cachedUsers?.get(actorUserId);
    if (cachedName) {
      return cachedName;
    }

    const users = await loadChatUsers();
    return users.get(actorUserId) || actorUserId;
  };

  async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    return registerWebServiceWorker(serviceWorkerRegistration);
  }

  async function unsubscribeFromPushNotificationsInternal(): Promise<void> {
    await unsubscribeFromWebPushNotifications({
      serviceWorkerRegistration,
    });
  }

  async function subscribeToPushNotifications(): Promise<void> {
    if (isSubscribing.value || !isPushNotificationsEnabled()) {
      return;
    }

    isSubscribing.value = true;

    try {
      await syncWebPushSubscription({
        serviceWorkerRegistration,
        isPushEnabled: isPushNotificationsEnabled,
        shouldKeepSubscription: shouldKeepPushSubscription,
      });
    } catch {
      return;
    } finally {
      isSubscribing.value = false;
    }
  }

  async function requestNotificationPermission(): Promise<boolean> {
    return requestWebNotificationPermission();
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

  async function handleChatTransfer(
    chat: IChat,
    previousChat: IChat | null = null
  ): Promise<boolean> {
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

    if (!canReceiveTransferNotification(chat, chatStore)) {
      return true;
    }

    if (isViewingChatConversation(chat.chat_id)) {
      return true;
    }

    const actorUserId = event?.actor_user_id || '';
    const actorUserName = await getTransferActorName(actorUserId);
    const contactName = getChatTitle(chat, t('chat_notification_transfer'));
    const contactPhoto = chat.photo || chat.contact?.photo;

    const title = t('chat_notification_transfer_title', {
      operator:
        actorUserName ||
        actorUserId ||
        t('chat_notification_transfer_operator_fallback'),
    });
    const body = formatNotificationBody(
      t('chat_notification_transfer_received', { contact: contactName })
    );

    if (isSoundNotificationsEnabled()) {
      playAlertSound();
    }

    if (isToastNotificationsEnabled()) {
      showTransferToast({
        id: `${chat.chat_id}-${actorUserId || 'system'}`,
        type: 'transfer',
        chat_id: chat.chat_id,
        actor_user_id: actorUserId,
        actor_user_name: actorUserName || actorUserId,
        contact_name: contactName,
        contact_photo: contactPhoto ?? undefined,
      });
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
    void chat;
    void previousStatus;
  }

  function handleVisibilityChange() {
    isPageVisible.value = !document.hidden;
    postNotificationClientState();
    if (!document.hidden) {
      void runNotificationSettingsSync();
    }
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

  function handleNotificationRepairTrigger(): void {
    void runNotificationSettingsSync();
  }

  onMounted(async () => {
    isPageVisible.value = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleNotificationRepairTrigger);
    postNotificationClientState();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        handleNotificationRepairTrigger
      );

      if (isPushNotificationsEnabled()) {
        await registerServiceWorker();
      }

      serviceWorkerMessageHandler = (event: Event) => {
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

      navigator.serviceWorker.addEventListener(
        'message',
        serviceWorkerMessageHandler
      );
    }

    notificationSyncInterval = window.setInterval(
      handleNotificationRepairTrigger,
      5 * 60 * 1000
    );
  });

  onUnmounted(() => {
    if (notificationSyncInterval) {
      window.clearInterval(notificationSyncInterval);
      notificationSyncInterval = null;
    }
    window.removeEventListener('online', handleNotificationRepairTrigger);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleNotificationRepairTrigger
      );
      if (serviceWorkerMessageHandler) {
        navigator.serviceWorker.removeEventListener(
          'message',
          serviceWorkerMessageHandler
        );
        serviceWorkerMessageHandler = null;
      }
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  watch(
    [
      () => chatStore.user?.user_id,
      () => chatStore.user?.chat_user?.notifications,
      () => chatStore.user?.chat_user?.notifications_sound,
      () => chatStore.user?.chat_user?.notifications_toast,
      () => chatStore.user?.chat_user?.notifications_push,
      () => chatStore.user?.chat_user?.notifications_browser,
      () => chatStore.user?.chat_user?.notifications_message_queue,
      () => chatStore.user?.chat_user?.notifications_message_in_chat,
      () => chatStore.user?.chat_user?.notifications_message_chatbot,
      () => chatStore.user?.chat_user?.notifications_transfer,
      () => chatStore.user?.chat_user?.notifications_internal_chat,
      () => chatStore.user?.chat_user?.notifications_internal_chat_push,
    ],
    async () => {
      await runNotificationSettingsSync();
    },
    { immediate: true }
  );

  watch(
    () => chatStore.activeChat?.chat_id,
    () => {
      postNotificationClientState();
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
  await unsubscribeFromWebPushNotifications();
}
