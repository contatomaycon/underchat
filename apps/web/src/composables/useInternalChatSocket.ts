import { internalChatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { emitInternalChatNotificationMessage } from '@/composables/useInternalChatNotifications';

let isInitialized = false;
let initializingPromise: Promise<void> | null = null;
let subscribedChannel: string | null = null;
let channelHandler: ((data: unknown) => void | Promise<void>) | null = null;

const createInternalChatSocket = () => {
  const internalChatStore = useInternalChatStore();

  const initializeSocket = async () => {
    if (isInitialized || !internalChatStore.user?.account_id) {
      return;
    }

    if (initializingPromise) {
      return initializingPromise;
    }

    const channel = internalChatAccountCentrifugo(
      internalChatStore.user.account_id
    );

    initializingPromise = (async () => {
      channelHandler = (payload: unknown) => {
        const message = internalChatStore.handleRealtimePayload(payload);
        if (message) {
          emitInternalChatNotificationMessage(message);
        }
      };

      await onMessage(channel, channelHandler);

      subscribedChannel = channel;
      isInitialized = true;
    })();

    try {
      await initializingPromise;
    } catch (error) {
      if (channelHandler) {
        await unsubscribe(channel, channelHandler).catch(() => {});
      }

      channelHandler = null;
      subscribedChannel = null;
      isInitialized = false;
      throw error;
    } finally {
      initializingPromise = null;
    }
  };

  const cleanup = async () => {
    if (initializingPromise) {
      await initializingPromise.catch(() => {});
    }

    if (!subscribedChannel || !channelHandler) {
      isInitialized = false;
      initializingPromise = null;
      subscribedChannel = null;
      channelHandler = null;
      return;
    }

    await unsubscribe(subscribedChannel, channelHandler);
    isInitialized = false;
    initializingPromise = null;
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
