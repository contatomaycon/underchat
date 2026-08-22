import { internalChatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  acknowledgeRecoveryFallback,
  addCentrifugoLifecycleListener,
  fetchHistoryAndProcess,
  onMessage,
  unsubscribe,
  type CentrifugoLifecycleEvent,
} from '@/@webcore/centrifugo';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { emitInternalChatNotificationMessage } from '@/composables/useInternalChatNotifications';

let isInitialized = false;
let initializingPromise: Promise<void> | null = null;
let initializingAccountId: string | null = null;
let initializedAccountId: string | null = null;
let subscribedChannel: string | null = null;
let channelHandler: ((data: unknown) => void | Promise<void>) | null = null;
let lifecycleGeneration = 0;
let removeLifecycleListener: (() => void) | null = null;
let recoveryPromise: Promise<void> | null = null;

const createInternalChatSocket = () => {
  const internalChatStore = useInternalChatStore();

  const recoverAuthoritativeState = (
    channel: string,
    accountId: string,
    generation: number
  ): void => {
    if (recoveryPromise) {
      return;
    }

    const attempt = (async () => {
      await internalChatStore.viewUnreadSummary();
      if (
        lifecycleGeneration !== generation ||
        internalChatStore.user?.account_id !== accountId
      ) {
        return;
      }

      internalChatStore.scheduleRefreshConversations(0);
      if (!acknowledgeRecoveryFallback(channel)) {
        return;
      }

      await fetchHistoryAndProcess(channel);
    })()
      .catch(() => {})
      .finally(() => {
        if (recoveryPromise === attempt) {
          recoveryPromise = null;
        }
      });

    recoveryPromise = attempt;
  };

  const handleLifecycleEvent = (event: CentrifugoLifecycleEvent): void => {
    const accountId = internalChatStore.user?.account_id;
    if (
      !accountId ||
      event.type !== 'recovery_failed' ||
      event.channel !== internalChatAccountCentrifugo(accountId)
    ) {
      return;
    }

    recoverAuthoritativeState(event.channel, accountId, lifecycleGeneration);
  };

  const installLifecycleListener = (): void => {
    if (!removeLifecycleListener) {
      removeLifecycleListener =
        addCentrifugoLifecycleListener(handleLifecycleEvent);
    }
  };

  const teardownActiveSubscription = async (): Promise<void> => {
    const previousChannel = subscribedChannel;
    const previousHandler = channelHandler;

    isInitialized = false;
    initializedAccountId = null;
    subscribedChannel = null;
    channelHandler = null;

    if (previousChannel && previousHandler) {
      await unsubscribe(previousChannel, previousHandler).catch(() => {});
    }
  };

  const initializeSocket = async () => {
    const accountId = internalChatStore.user?.account_id;
    if (!accountId) {
      return;
    }

    installLifecycleListener();

    if (
      isInitialized &&
      initializedAccountId === accountId &&
      subscribedChannel === internalChatAccountCentrifugo(accountId)
    ) {
      return;
    }

    if (initializingPromise && initializingAccountId === accountId) {
      return initializingPromise;
    }

    const attemptGeneration = ++lifecycleGeneration;
    const previousLifecycle = initializingPromise?.catch(() => {});
    initializingAccountId = accountId;

    const attempt = (async () => {
      await previousLifecycle;
      if (
        lifecycleGeneration !== attemptGeneration ||
        internalChatStore.user?.account_id !== accountId
      ) {
        return;
      }

      await teardownActiveSubscription();
      if (
        lifecycleGeneration !== attemptGeneration ||
        internalChatStore.user?.account_id !== accountId
      ) {
        return;
      }

      const channel = internalChatAccountCentrifugo(accountId);
      const handler = (payload: unknown) => {
        if (
          lifecycleGeneration !== attemptGeneration ||
          internalChatStore.user?.account_id !== accountId
        ) {
          return;
        }

        const message = internalChatStore.handleRealtimePayload(payload);
        if (message) {
          emitInternalChatNotificationMessage(message);
        }
      };

      await onMessage(channel, handler);
      if (
        lifecycleGeneration !== attemptGeneration ||
        internalChatStore.user?.account_id !== accountId
      ) {
        await unsubscribe(channel, handler).catch(() => {});
        return;
      }

      channelHandler = handler;
      subscribedChannel = channel;
      initializedAccountId = accountId;
      isInitialized = true;
    })();
    initializingPromise = attempt;

    try {
      await attempt;
    } catch (error) {
      if (lifecycleGeneration === attemptGeneration) {
        await teardownActiveSubscription();
      }
      throw error;
    } finally {
      if (initializingPromise === attempt) {
        initializingPromise = null;
        initializingAccountId = null;
      }
    }
  };

  const cleanup = async () => {
    const cleanupGeneration = ++lifecycleGeneration;
    const previousLifecycle = initializingPromise?.catch(() => {});
    isInitialized = false;
    initializedAccountId = null;
    initializingAccountId = null;

    const cleanupAttempt = (async () => {
      await previousLifecycle;
      if (lifecycleGeneration !== cleanupGeneration) {
        return;
      }
      await teardownActiveSubscription();
    })();
    initializingPromise = cleanupAttempt;

    try {
      await cleanupAttempt;
    } finally {
      if (initializingPromise === cleanupAttempt) {
        initializingPromise = null;
      }
    }

    if (removeLifecycleListener) {
      removeLifecycleListener();
      removeLifecycleListener = null;
    }
    recoveryPromise = null;
  };

  return {
    initializeSocket,
    cleanup,
    isInitialized: () => {
      const accountId = internalChatStore.user?.account_id;
      return (
        Boolean(accountId) &&
        isInitialized &&
        initializedAccountId === accountId &&
        subscribedChannel === internalChatAccountCentrifugo(accountId ?? '')
      );
    },
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
