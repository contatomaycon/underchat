import {
  acknowledgeRecoveryFallback,
  addCentrifugoLifecycleListener,
  fetchHistoryAndProcess,
  onMessage,
  unsubscribe,
  type CentrifugoLifecycleEvent,
} from '@/@webcore/centrifugo';
import {
  logConnectionLifecycleDebug,
  type ConnectionLifecycleDebugContext,
} from '@/@webcore/utils/connectionLifecycleDebug';
import {
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';

type CentrifugoMessageHandler = Parameters<typeof onMessage>[1];

interface ResilientCentrifugoSubscriptionOptions {
  channel: MaybeRefOrGetter<string | null | undefined>;
  handler: CentrifugoMessageHandler;
  onSubscribed?: (channel: string) => void | Promise<void>;
  /**
   * Set only when `onSubscribed` performs an authoritative HTTP/database
   * reconciliation. It allows the composable to advance a blocked recovery
   * cursor and then replay the API race window.
   */
  acknowledgeRecoveryAfterSubscribed?: boolean;
  debugContext?: () => ConnectionLifecycleDebugContext;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15_000;

/**
 * Keeps an account subscription alive even when the first token request or
 * websocket handshake fails. Centrifuge reconnects an established client on
 * its own; this guard covers the gap before a handler has ever been installed
 * and terminal subscription events that otherwise required a page refresh.
 */
export const useResilientCentrifugoSubscription = (
  options: ResilientCentrifugoSubscriptionOptions
) => {
  const isSubscribed = shallowRef(false);
  const retryAttempt = shallowRef(0);
  let activeChannel: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let operationGeneration = 0;
  let stopped = false;
  let subscribing = false;
  let recoveryFallbackPending = false;

  const debug = (
    event: string,
    context: ConnectionLifecycleDebugContext = {}
  ): void => {
    logConnectionLifecycleDebug(event, {
      layer: 'web.centrifugo.resilient_subscription',
      ...(options.debugContext?.() ?? {}),
      channel: activeChannel ?? undefined,
      retry_attempt: retryAttempt.value,
      ...context,
    });
  };

  const clearRetry = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const calculateRetryDelay = (): number => {
    const base = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    const maximum = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    return Math.min(base * 2 ** retryAttempt.value, maximum);
  };

  const subscribeCurrentChannel = async (): Promise<void> => {
    const channel = activeChannel;
    if (!channel || stopped || subscribing) return;

    const generation = operationGeneration;
    let retryAfterFailure = false;
    subscribing = true;
    clearRetry();

    try {
      await onMessage(channel, options.handler);

      if (
        stopped ||
        generation !== operationGeneration ||
        channel !== activeChannel
      ) {
        await unsubscribe(channel, options.handler);
        return;
      }

      isSubscribed.value = true;
      debug('web.centrifugo.subscription.ready');

      try {
        await options.onSubscribed?.(channel);

        if (
          stopped ||
          generation !== operationGeneration ||
          channel !== activeChannel
        ) {
          return;
        }

        if (
          recoveryFallbackPending &&
          options.acknowledgeRecoveryAfterSubscribed
        ) {
          const acknowledged = acknowledgeRecoveryFallback(channel);
          if (acknowledged) {
            const catchUp = await fetchHistoryAndProcess(channel);
            if (catchUp.requiresFallback) {
              throw new Error(
                `centrifugo_recovery_catch_up_${catchUp.reason ?? 'failed'}`
              );
            }
          }
          recoveryFallbackPending = false;
          debug('web.centrifugo.subscription.recovery_reconciled');
        }

        if (
          stopped ||
          generation !== operationGeneration ||
          channel !== activeChannel
        ) {
          return;
        }
        retryAttempt.value = 0;
      } catch {
        if (
          stopped ||
          generation !== operationGeneration ||
          channel !== activeChannel
        ) {
          return;
        }
        // A history/API reconciliation failure must not tear down a healthy
        // live subscription. Re-entering onMessage is idempotent and retries
        // only reconciliation with the same bounded exponential backoff.
        debug('web.centrifugo.subscription.reconcile_failed', {
          reason: 'reconcile_failed',
        });
        retryAfterFailure = true;
      }
    } catch {
      if (
        !stopped &&
        generation === operationGeneration &&
        channel === activeChannel
      ) {
        isSubscribed.value = false;
        debug('web.centrifugo.subscription.failed', {
          reason: 'subscribe_failed',
        });
        retryAfterFailure = true;
      }
    } finally {
      if (generation === operationGeneration) {
        subscribing = false;
        if (retryAfterFailure) scheduleRetry();
      }
    }
  };

  function scheduleRetry(immediate = false): void {
    if (stopped || !activeChannel || retryTimer || subscribing) return;

    const delay = immediate ? 0 : calculateRetryDelay();
    if (!immediate) {
      retryAttempt.value = Math.min(retryAttempt.value + 1, 10);
    }

    retryTimer = setTimeout(() => {
      retryTimer = null;
      void subscribeCurrentChannel();
    }, delay);
  }

  const switchChannel = async (
    nextChannel: string | null | undefined
  ): Promise<void> => {
    const normalizedChannel = nextChannel?.trim() || null;
    if (normalizedChannel === activeChannel) {
      if (normalizedChannel && !isSubscribed.value) scheduleRetry(true);
      return;
    }

    const previousChannel = activeChannel;
    operationGeneration += 1;
    activeChannel = normalizedChannel;
    subscribing = false;
    isSubscribed.value = false;
    retryAttempt.value = 0;
    recoveryFallbackPending = false;
    clearRetry();

    if (previousChannel) {
      await unsubscribe(previousChannel, options.handler);
    }

    if (activeChannel && !stopped) {
      debug('web.centrifugo.subscription.start');
      scheduleRetry(true);
    }
  };

  const handleLifecycleEvent = (event: CentrifugoLifecycleEvent): void => {
    if (stopped || !activeChannel) return;
    if ('channel' in event && event.channel !== activeChannel) return;

    if (event.type === 'connected') {
      // Re-run onMessage so a handler that failed before its first successful
      // registration is installed, then reconcile the publication gap.
      if (!subscribing) scheduleRetry(true);
      return;
    }

    if (
      event.type === 'connection_lost' ||
      event.type === 'subscription_unsubscribed'
    ) {
      isSubscribed.value = false;
      debug('web.centrifugo.subscription.interrupted', {
        reason: event.type,
      });
      if (!subscribing) scheduleRetry();
      return;
    }

    if (event.type === 'recovery_failed') {
      recoveryFallbackPending =
        options.acknowledgeRecoveryAfterSubscribed === true;
      // The subscription may still be live. Calling onMessage is idempotent
      // and invokes onSubscribed, which performs the authoritative replay.
      if (!subscribing) scheduleRetry(true);
    }
  };

  const removeLifecycleListener =
    addCentrifugoLifecycleListener(handleLifecycleEvent);
  const stopChannelWatch = watch(
    () => toValue(options.channel),
    (channel) => {
      void switchChannel(channel);
    },
    { immediate: true }
  );

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    operationGeneration += 1;
    clearRetry();
    stopChannelWatch();
    removeLifecycleListener();
    const channel = activeChannel;
    activeChannel = null;
    isSubscribed.value = false;
    subscribing = false;
    if (channel) void unsubscribe(channel, options.handler);
  };

  onScopeDispose(stop);

  return {
    isSubscribed: shallowReadonly(isSubscribed),
    retryAttempt: shallowReadonly(retryAttempt),
    retry: () => scheduleRetry(true),
    stop,
  };
};
