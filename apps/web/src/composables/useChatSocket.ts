import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@/@webcore/stores/chat';
import { getPermissions, getSectors } from '@/@webcore/localStorage/user';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { useChatNotifications } from '@/composables/useChatNotifications';

let isInitialized = false;
let subscriptions: Array<{
  channel: string;
  unsubscribe: () => Promise<void>;
}> = [];
const pendingMessages = ref<Map<string, IChatMessage[]>>(new Map());
const pendingChatUpdates = ref<Map<string, IChat[]>>(new Map());

export const useChatSocket = () => {
  const chatStore = useChatStore();
  const route = useRoute();
  const { handleNewMessage } = useChatNotifications();

  const isChatRoute = () => {
    return route.name === 'chat';
  };

  const canReceiveChatNotification = (chat: IChat): boolean => {
    if (!chatStore.user?.account_id) return false;

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

    if (
      chat.status === EChatStatus.queue &&
      !chat.sector?.id &&
      !chat.user?.id
    ) {
      return true;
    }

    if (userSectors.length === 0) {
      return !chat.sector?.id;
    }

    if (!chat.sector?.id) {
      return false;
    }

    return userSectors.includes(chat.sector.id);
  };

  const handleMessageEvent = async (
    messageData: IChatMessage
  ): Promise<void> => {
    const isActiveChat =
      isChatRoute() && chatStore.activeChat?.chat_id === messageData.chat_id;

    if (isActiveChat) {
      chatStore.addMessageActiveChat(messageData);
      globalThis.dispatchEvent(
        new CustomEvent('chat-message', { detail: messageData })
      );
    } else {
      await handleNewMessage(messageData);
    }

    const chatId = messageData.chat_id;
    if (!pendingMessages.value.has(chatId)) {
      pendingMessages.value.set(chatId, []);
    }
    pendingMessages.value.get(chatId)?.push(messageData);
  };

  const handleChatUpdateEvent = async (chatData: IChat): Promise<void> => {
    if (!canReceiveChatNotification(chatData)) {
      return;
    }

    chatStore.addChat(chatData);

    if (
      isChatRoute() &&
      chatStore.activeChat?.chat_id === chatData.chat_id &&
      (chatData as any)._active &&
      chatData.user?.id === chatStore.user?.user_id
    ) {
      chatStore.setActiveChat(chatData.chat_id);
      const requestQueue: ListMessageChatsQuery = {
        current_page: 1,
        per_page: 10,
      };
      await chatStore.getChatById(requestQueue);
      return;
    }

    const chatId = chatData.chat_id;
    if (!pendingChatUpdates.value.has(chatId)) {
      pendingChatUpdates.value.set(chatId, []);
    }
    pendingChatUpdates.value.get(chatId)?.push(chatData);
  };

  const processPendingMessages = async (chatId: string) => {
    const messages = pendingMessages.value.get(chatId);
    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      chatStore.addMessageActiveChat(message);
    }

    pendingMessages.value.delete(chatId);
  };

  const processPendingChatUpdates = async (chatId: string) => {
    const updates = pendingChatUpdates.value.get(chatId);
    if (!updates || updates.length === 0) return;

    const lastUpdate = updates[updates.length - 1];
    if (lastUpdate) {
      chatStore.addChat(lastUpdate);
    }

    pendingChatUpdates.value.delete(chatId);
  };

  const initializeSocket = async () => {
    if (isInitialized || !chatStore.user?.account_id) {
      return;
    }

    const accountId = chatStore.user.account_id;

    try {
      await onMessage(
        chatAccountCentrifugo(accountId),
        async (data: IChatMessage | IChatTyping | IChat | any) => {
          if ('type' in data && data.type === 'typing') {
            globalThis.dispatchEvent(
              new CustomEvent('chat-typing', { detail: data })
            );
            return;
          }

          if ('message_id' in data) {
            handleMessageEvent(data as IChatMessage);
            if (isChatRoute()) {
              globalThis.dispatchEvent(
                new CustomEvent('chat-message', { detail: data })
              );
            }
            return;
          }

          if ('chat_id' in data && !('message_id' in data)) {
            await handleChatUpdateEvent(data as IChat);
            if (isChatRoute()) {
              globalThis.dispatchEvent(
                new CustomEvent('chat-update', { detail: data })
              );
            }
          }
        }
      );

      await onMessage(chatQueueAccountCentrifugo(accountId), (data: IChat) => {
        if (!canReceiveChatNotification(data)) {
          return;
        }

        chatStore.addChat(data);

        if (
          chatStore.user?.account_id &&
          chatStore.activeChat?.chat_id === data.chat_id &&
          data.status === EChatStatus.in_chat
        ) {
          globalThis.dispatchEvent(
            new CustomEvent('chat-queue-update', { detail: data })
          );
        }
      });

      subscriptions.push(
        {
          channel: chatAccountCentrifugo(accountId),
          unsubscribe: () => unsubscribe(chatAccountCentrifugo(accountId)),
        },
        {
          channel: chatQueueAccountCentrifugo(accountId),
          unsubscribe: () => unsubscribe(chatQueueAccountCentrifugo(accountId)),
        }
      );

      isInitialized = true;
    } catch (error) {
      console.error('Erro ao inicializar socket de chat:', error);
    }
  };

  const cleanup = async () => {
    const unsubscribePromises = subscriptions.map((sub) =>
      sub.unsubscribe().catch((error) => {
        console.error('Erro ao fazer unsubscribe:', error);
      })
    );

    await Promise.all(unsubscribePromises);

    subscriptions = [];
    isInitialized = false;
    pendingMessages.value.clear();
    pendingChatUpdates.value.clear();
  };

  const refreshActiveChat = async () => {
    if (!isChatRoute() || !chatStore.activeChat?.chat_id) {
      return;
    }

    const chatId = chatStore.activeChat.chat_id;

    chatStore.ensureActiveChatUnreadCountIsZero();

    await Promise.all([
      processPendingMessages(chatId),
      processPendingChatUpdates(chatId),
    ]);

    const requestQueue: ListMessageChatsQuery = {
      current_page: 1,
      per_page: 10,
    };
    await chatStore.getChatById(requestQueue);
  };

  return {
    initializeSocket,
    cleanup,
    refreshActiveChat,
    processPendingMessages,
    processPendingChatUpdates,
    isInitialized: () => isInitialized,
  };
};
