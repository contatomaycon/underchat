import { ref } from 'vue';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';

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

  function hideToast() {
    activeNotification.value = null;
  }

  return {
    activeNotification,
    showMessageToast,
    showStatusToast,
    hideToast,
  };
}
