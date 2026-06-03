import { ref } from 'vue';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';

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
  | {
      id: string;
      type: 'transfer';
      chat: IChat;
    }
  | {
      id: string;
      type: 'internal-message';
      message: ListMessagesResponse['data']['results'][number];
    };

const activeNotification = ref<ChatNotificationToastPayload | null>(null);

export function useChatNotificationToast() {
  function showMessageToast(message: IChatMessage) {
    activeNotification.value = {
      id: message.message_id,
      type: 'message',
      message,
    };
  }

  function showStatusToast(chat: IChat) {
    activeNotification.value = {
      id: `${chat.chat_id}-${chat.status}`,
      type: 'status',
      chat,
    };
  }

  function showTransferToast(chat: IChat) {
    activeNotification.value = {
      id: `${chat.chat_id}-transfer`,
      type: 'transfer',
      chat,
    };
  }

  function showInternalMessageToast(
    message: ListMessagesResponse['data']['results'][number]
  ) {
    activeNotification.value = {
      id: `internal-${message.message_id}`,
      type: 'internal-message',
      message,
    };
  }

  function hideToast() {
    activeNotification.value = null;
  }

  return {
    activeNotification,
    showMessageToast,
    showStatusToast,
    showTransferToast,
    showInternalMessageToast,
    hideToast,
  };
}
