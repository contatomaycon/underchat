import { ref } from 'vue';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';

const activeNotification = ref<{
  message: IChatMessage;
  id: string;
} | null>(null);

export function useChatNotificationToast() {
  function showToast(message: IChatMessage) {
    activeNotification.value = {
      message,
      id: message.message_id,
    };
  }

  function hideToast() {
    activeNotification.value = null;
  }

  return {
    activeNotification,
    showToast,
    hideToast,
  };
}
