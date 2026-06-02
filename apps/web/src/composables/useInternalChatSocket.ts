import { internalChatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { emitInternalChatNotificationMessage } from '@/composables/useInternalChatNotifications';

let isInitialized = false;
let subscribedChannel: string | null = null;
let channelHandler: ((data: unknown) => void | Promise<void>) | null = null;

const createInternalChatSocket = () => {
  const internalChatStore = useInternalChatStore();

  const initializeSocket = async () => {
    if (isInitialized || !internalChatStore.user?.account_id) {
      return;
    }

    const channel = internalChatAccountCentrifugo(
      internalChatStore.user.account_id
    );

    channelHandler = (payload: unknown) => {
      const message = internalChatStore.handleRealtimePayload(payload);
      if (message) {
        emitInternalChatNotificationMessage(message);
      }
    };

    await onMessage(channel, channelHandler);

    subscribedChannel = channel;
    isInitialized = true;
  };

  const cleanup = async () => {
    if (!subscribedChannel || !channelHandler) {
      isInitialized = false;
      subscribedChannel = null;
      channelHandler = null;
      return;
    }

    await unsubscribe(subscribedChannel, channelHandler);
    isInitialized = false;
    subscribedChannel = null;
    channelHandler = null;
  };

  return {
    initializeSocket,
    cleanup,
    isInitialized: () => isInitialized,
  };
};

let internalChatSocketInstance: ReturnType<
  typeof createInternalChatSocket
> | null = null;

export const useInternalChatSocket = () => {
  if (!internalChatSocketInstance) {
    internalChatSocketInstance = createInternalChatSocket();
  }

  return internalChatSocketInstance;
};
