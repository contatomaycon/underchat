import {
  Centrifuge,
  type DisconnectedContext,
  type PublicationContext,
  type PublishResult,
  State,
  SubscriptionState,
  type SubscribedContext,
  type Subscription,
  type UnsubscribedContext,
} from 'centrifuge';
import { isAxiosError } from 'axios';
import axios from '@webcore/axios';
import { getTokenJwtData, getUser } from './localStorage/user';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { AuthTokenResponse } from '@core/schema/centrifugo/token/response.schema';

export type { Subscription };

type StreamPosition = { offset: number; epoch: string };

export type CentrifugoLifecycleEvent =
  | {
      type: 'connected';
    }
  | {
      type: 'connection_lost';
      code: number;
      reason: string;
    }
  | {
      type: 'subscription_unsubscribed';
      channel: string;
      code: number;
      reason: string;
    }
  | {
      type: 'recovery_failed';
      channel: string;
      reason: 'server_recovery_failed' | 'publication_handler_failed';
    };

export interface HistoryProcessResult {
  processed: number;
  newOffset?: number;
  recovered: boolean;
  requiresFallback: boolean;
  reason?:
    | 'not_subscribed'
    | 'missing_position'
    | 'history_unavailable'
    | 'history_gap'
    | 'handler_failed';
}

let centrifugeClient: Centrifuge | null = null;
let connectionAuthKey: string | null = null;
let connectionPromise: {
  authKey: string;
  promise: Promise<Centrifuge>;
} | null = null;
let tokenGenerationPromise: {
  authKey: string;
  promise: Promise<AuthTokenResponse>;
} | null = null;
let cachedToken: {
  token: string;
  url: string;
  expiresAt: number;
  authKey: string;
} | null = null;
const TOKEN_CACHE_MARGIN_MS = 5 * 60 * 1000;
const channelHandlers = new Map<
  string,
  Set<(data: any, ctx: PublicationContext) => void>
>();
const channelSubscriptions = new Map<string, Subscription>();
const channelStreamPositions = new Map<string, StreamPosition>();
const channelRecoveryStates = new Map<
  string,
  { head: StreamPosition; cursorBlocked: boolean }
>();
const subscriptionHandlersBound = new WeakSet<Subscription>();
const subscriptionHandlerCleanups = new WeakMap<Subscription, () => void>();
const clientHandlerCleanups = new WeakMap<Centrifuge, () => void>();
const lifecycleListeners = new Set<(event: CentrifugoLifecycleEvent) => void>();

const emitLifecycleEvent = (event: CentrifugoLifecycleEvent): void => {
  for (const listener of lifecycleListeners) {
    try {
      listener(event);
    } catch {}
  }
};

const dispatchLegacyRecoveryFailedEvent = (channel: string): void => {
  if (typeof globalThis.dispatchEvent !== 'function') {
    return;
  }

  globalThis.dispatchEvent(
    new CustomEvent('centrifugo-recovery-failed', {
      detail: { channel },
    })
  );
};

const clearCachedToken = (): void => {
  cachedToken = null;
  tokenGenerationPromise = null;
};

const getRealtimeAuthKey = (): string => {
  try {
    const tokenData = getTokenJwtData();
    if (tokenData) {
      return `${tokenData.account_id}:${tokenData.user_id}`;
    }

    const user = getUser();
    return `${user?.account_id ?? ''}:${user?.user_id ?? ''}`;
  } catch {
    return ':';
  }
};

const isTokenExpiredSignal = (code: number, reason: string): boolean => {
  if (code === 109 || code === 3501) {
    return true;
  }

  return reason.toLowerCase().includes('token expired');
};

const generateTokenAndUrl = async (): Promise<AuthTokenResponse> => {
  const now = Date.now();
  const authKey = getRealtimeAuthKey();

  if (
    cachedToken &&
    cachedToken.authKey === authKey &&
    cachedToken.expiresAt > now + TOKEN_CACHE_MARGIN_MS
  ) {
    return { token: cachedToken.token, url: cachedToken.url };
  }

  if (tokenGenerationPromise?.authKey === authKey) {
    return tokenGenerationPromise.promise;
  }

  tokenGenerationPromise = {
    authKey,
    promise: (async () => {
      try {
        const response = await axios.post<IApiResponse<AuthTokenResponse>>(
          `/centrifugo/auth/token`
        );

        const data = response?.data;

        if (!data?.status) {
          throw new Error(
            data?.message ?? 'Failed to generate Centrifugo token'
          );
        }

        cachedToken = {
          token: data.data.token,
          url: data.data.url,
          expiresAt: now + 24 * 60 * 60 * 1000,
          authKey,
        };

        return data.data;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          clearCachedToken();
        }

        throw error;
      } finally {
        if (tokenGenerationPromise?.authKey === authKey) {
          tokenGenerationPromise = null;
        }
      }
    })(),
  };

  return tokenGenerationPromise.promise;
};

const generateToken = async (): Promise<string> => {
  const tokenData = await generateTokenAndUrl();

  if (!tokenData?.token) {
    throw new Error('Token is not available in the response');
  }

  return tokenData.token;
};

const waitForConnected = (
  client: Centrifuge,
  timeoutMs = 30000
): Promise<void> => {
  if (client.state === State.Connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    let cleanup: () => void;

    const onError = (err: unknown): void => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    };

    const onConnected = (): void => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    };

    const onDisconnected = (ctx: DisconnectedContext): void => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Centrifugo disconnected before connect: ${ctx.reason || ctx.code}`
          )
        );
      }
    };

    cleanup = (): void => {
      client.off('connected', onConnected);
      client.off('error', onError);
      client.off('disconnected', onDisconnected);
      if (timer) {
        clearTimeout(timer);
      }
    };

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Connection timeout'));
      }
    }, timeoutMs);

    client.on('connected', onConnected);
    client.on('error', onError);
    client.on('disconnected', onDisconnected);

    if (client.state === State.Disconnected) {
      client.connect();
    }
  });
};

const waitForSubscribed = (
  sub: Subscription,
  timeoutMs = 10000
): Promise<void> => {
  if (sub.state === SubscriptionState.Subscribed) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cleanup = (): void => {};

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fn();
    };

    const onSubscribed = (): void => {
      settle(resolve);
    };

    const onUnsubscribed = (ctx: { reason?: string }): void => {
      settle(() =>
        reject(new Error(ctx.reason || 'Centrifugo subscription closed'))
      );
    };

    const onError = (ctx: unknown): void => {
      settle(() => reject(ctx instanceof Error ? ctx : new Error(String(ctx))));
    };

    cleanup = (): void => {
      sub.off('subscribed', onSubscribed);
      sub.off('unsubscribed', onUnsubscribed);
      sub.off('error', onError);
      if (timer) {
        clearTimeout(timer);
      }
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error('Subscription timeout')));
    }, timeoutMs);

    sub.on('subscribed', onSubscribed);
    sub.on('unsubscribed', onUnsubscribed);
    sub.on('error', onError);
  });
};

const markRecoveryFailed = (
  channel: string,
  head: StreamPosition,
  reason: 'server_recovery_failed' | 'publication_handler_failed'
): void => {
  const wasAlreadyBlocked =
    channelRecoveryStates.get(channel)?.cursorBlocked === true;

  channelRecoveryStates.set(channel, {
    head,
    cursorBlocked: true,
  });

  if (wasAlreadyBlocked) {
    return;
  }

  emitLifecycleEvent({ type: 'recovery_failed', channel, reason });
  dispatchLegacyRecoveryFailedEvent(channel);
};

const processPublicationThroughHandlers = (
  pub: { data: unknown; offset?: number },
  handlers: Set<(data: any, ctx: PublicationContext) => void>
): boolean => {
  let processedSuccessfully = true;

  for (const handler of handlers) {
    try {
      handler(pub.data, pub as PublicationContext);
    } catch {
      processedSuccessfully = false;
    }
  }

  return processedSuccessfully;
};

const commitPublicationPosition = (channel: string, offset: number): void => {
  const recoveryState = channelRecoveryStates.get(channel);
  if (recoveryState?.cursorBlocked) {
    return;
  }

  const currentPosition = channelStreamPositions.get(channel);
  if (currentPosition && offset <= currentPosition.offset) {
    return;
  }

  const epoch = recoveryState?.head.epoch ?? currentPosition?.epoch ?? '';
  channelStreamPositions.set(channel, { offset, epoch });

  if (recoveryState && offset >= recoveryState.head.offset) {
    channelRecoveryStates.delete(channel);
  }
};

const setupSubscriptionHandlers = (
  sub: Subscription,
  channel: string
): void => {
  if (
    subscriptionHandlersBound.has(sub) &&
    subscriptionHandlerCleanups.has(sub)
  ) {
    return;
  }

  subscriptionHandlersBound.add(sub);

  const onPublication = (ctx: PublicationContext): void => {
    const handlersForChannel = channelHandlers.get(channel);
    if (!handlersForChannel || handlersForChannel.size === 0) {
      return;
    }

    const processedSuccessfully = processPublicationThroughHandlers(
      ctx,
      handlersForChannel
    );

    if (!processedSuccessfully) {
      const currentPosition = channelStreamPositions.get(channel);
      const recoveryHead = channelRecoveryStates.get(channel)?.head;
      markRecoveryFailed(
        channel,
        recoveryHead ?? {
          offset:
            typeof ctx.offset === 'number'
              ? ctx.offset
              : (currentPosition?.offset ?? 0),
          epoch: currentPosition?.epoch ?? '',
        },
        'publication_handler_failed'
      );
      return;
    }

    if (typeof ctx.offset === 'number') {
      commitPublicationPosition(channel, ctx.offset);
    }
  };

  const onSubscribed = (ctx: SubscribedContext): void => {
    const streamPosition = ctx.streamPosition;
    if (!streamPosition) {
      return;
    }

    const currentPosition = channelStreamPositions.get(channel);

    if (ctx.wasRecovering && !ctx.recovered) {
      markRecoveryFailed(channel, streamPosition, 'server_recovery_failed');
      return;
    }

    if (ctx.wasRecovering && ctx.recovered) {
      if (ctx.hasRecoveredPublications) {
        channelRecoveryStates.set(channel, {
          head: streamPosition,
          cursorBlocked: false,
        });
      } else {
        channelRecoveryStates.delete(channel);
        channelStreamPositions.set(channel, streamPosition);
      }
      return;
    }

    if (!currentPosition) {
      channelRecoveryStates.delete(channel);
      channelStreamPositions.set(channel, {
        offset: streamPosition.offset,
        epoch: streamPosition.epoch,
      });
      return;
    }

    // A prior cursor existed but the server did not acknowledge a recovery.
    // Keep that cursor until history or the authoritative API reconciles state.
    markRecoveryFailed(channel, streamPosition, 'server_recovery_failed');
  };

  const onUnsubscribed = (ctx: UnsubscribedContext): void => {
    if (!channelHandlers.has(channel)) {
      return;
    }

    emitLifecycleEvent({
      type: 'subscription_unsubscribed',
      channel,
      code: ctx.code,
      reason: ctx.reason,
    });
  };

  sub.on('publication', onPublication);
  sub.on('subscribed', onSubscribed);
  sub.on('unsubscribed', onUnsubscribed);

  subscriptionHandlerCleanups.set(sub, () => {
    sub.off('publication', onPublication);
    sub.off('subscribed', onSubscribed);
    sub.off('unsubscribed', onUnsubscribed);
  });
};

const resubscribeActiveChannels = (client: Centrifuge): void => {
  const channelsToResubscribe = Array.from(channelHandlers.keys());

  for (const channel of channelsToResubscribe) {
    const handlers = channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) continue;

    const existingSub = client.getSubscription(channel);
    if (existingSub) {
      channelSubscriptions.set(channel, existingSub);
      setupSubscriptionHandlers(existingSub, channel);

      if (existingSub.state !== SubscriptionState.Subscribed) {
        existingSub.subscribe();
      }

      continue;
    }

    const streamPosition = channelStreamPositions.get(channel);
    const newSub = client.newSubscription(channel, {
      recoverable: true,
      ...(streamPosition && {
        since: {
          offset: streamPosition.offset,
          epoch: streamPosition.epoch,
        },
      }),
    });

    channelSubscriptions.set(channel, newSub);
    setupSubscriptionHandlers(newSub, channel);
    newSub.subscribe();
  }
};

const disconnectClient = (client: Centrifuge): void => {
  clientHandlerCleanups.get(client)?.();
  clientHandlerCleanups.delete(client);

  try {
    client.disconnect();
  } catch {}
};

const clearActiveConnection = (
  client: Centrifuge | null = centrifugeClient
): void => {
  const clearsCurrentConnection = !client || centrifugeClient === client;

  if (client) {
    disconnectClient(client);
  }

  if (!clearsCurrentConnection) {
    return;
  }

  centrifugeClient = null;
  connectionAuthKey = null;

  for (const subscription of channelSubscriptions.values()) {
    subscriptionHandlerCleanups.get(subscription)?.();
    subscriptionHandlerCleanups.delete(subscription);
  }
  channelSubscriptions.clear();
};

const setupClientHandlers = (client: Centrifuge): void => {
  const onConnected = (): void => {
    emitLifecycleEvent({ type: 'connected' });
  };

  const onDisconnected = (ctx: DisconnectedContext): void => {
    if (isTokenExpiredSignal(ctx.code, ctx.reason)) {
      clearCachedToken();
    }

    emitLifecycleEvent({
      type: 'connection_lost',
      code: ctx.code,
      reason: ctx.reason,
    });
  };

  const onError = (error: unknown): void => {
    if (!error || typeof error !== 'object') {
      return;
    }

    const payload = error as { code?: unknown; message?: unknown };
    const code =
      typeof payload.code === 'number' && Number.isFinite(payload.code)
        ? payload.code
        : 0;
    const reason =
      typeof payload.message === 'string' ? payload.message : 'unknown';

    if (isTokenExpiredSignal(code, reason)) {
      clearCachedToken();
    }
  };

  client.on('connected', onConnected);
  client.on('disconnected', onDisconnected);
  client.on('error', onError);

  clientHandlerCleanups.set(client, () => {
    client.off('connected', onConnected);
    client.off('disconnected', onDisconnected);
    client.off('error', onError);
  });
};

const createConnection = async (): Promise<Centrifuge> => {
  const authKey = getRealtimeAuthKey();
  const { token, url: wsUrl } = await generateTokenAndUrl();

  if (authKey !== getRealtimeAuthKey()) {
    throw new Error('Centrifugo auth context changed');
  }

  const client = new Centrifuge(`${wsUrl}/connection/websocket`, {
    websocket: WebSocket,
    token,
    getToken: async () => {
      try {
        return await generateToken();
      } catch (error) {
        throw error;
      }
    },
    timeout: 30000,
    maxServerPingDelay: 60000,
    minReconnectDelay: 1000,
    maxReconnectDelay: 10000,
  });

  centrifugeClient = client;
  connectionAuthKey = authKey;
  setupClientHandlers(client);

  client.connect();

  try {
    await waitForConnected(client);
  } catch (error) {
    clearActiveConnection(client);

    throw error;
  }

  if (authKey !== getRealtimeAuthKey()) {
    clearActiveConnection(client);

    throw new Error('Centrifugo auth context changed');
  }

  resubscribeActiveChannels(client);

  return client;
};

const getOrCreateConnection = (authKey: string): Promise<Centrifuge> => {
  if (!connectionPromise || connectionPromise.authKey !== authKey) {
    connectionPromise = {
      authKey,
      promise: createConnection().finally(() => {
        if (connectionPromise?.authKey === authKey) {
          connectionPromise = null;
        }
      }),
    };
  }

  return connectionPromise.promise;
};

const getConnection = async (): Promise<Centrifuge> => {
  const authKey = getRealtimeAuthKey();

  if (!centrifugeClient) {
    return getOrCreateConnection(authKey);
  }

  if (connectionAuthKey !== authKey) {
    clearActiveConnection();
    return getOrCreateConnection(authKey);
  }

  if (centrifugeClient.state === State.Connected) {
    return centrifugeClient;
  }

  if (centrifugeClient.state === State.Disconnected) {
    clearActiveConnection();
    return getOrCreateConnection(authKey);
  }

  try {
    await waitForConnected(centrifugeClient);
    return centrifugeClient;
  } catch {
    clearActiveConnection();
    return getOrCreateConnection(authKey);
  }
};

export const onMessage = async (
  channel: string,
  handler: (data: any, ctx: PublicationContext) => void
): Promise<Subscription> => {
  const client = await getConnection();

  let handlers = channelHandlers.get(channel);
  if (!handlers) {
    handlers = new Set();
    channelHandlers.set(channel, handlers);
  }

  if (handlers.has(handler)) {
    const existingSub = channelSubscriptions.get(channel);
    if (existingSub) {
      if (existingSub.state === SubscriptionState.Unsubscribed) {
        existingSub.subscribe();
      }

      await waitForSubscribed(existingSub);
      return existingSub;
    }
  }

  const handlerWasAdded = !handlers.has(handler);
  handlers.add(handler);

  let sub = channelSubscriptions.get(channel);
  if (!sub) {
    const existingSub = client.getSubscription(channel);
    if (existingSub) {
      sub = existingSub;
    } else {
      const streamPosition = channelStreamPositions.get(channel);
      sub = client.newSubscription(channel, {
        recoverable: true,
        ...(streamPosition && {
          since: {
            offset: streamPosition.offset,
            epoch: streamPosition.epoch,
          },
        }),
      });
    }
    channelSubscriptions.set(channel, sub);

    setupSubscriptionHandlers(sub, channel);

    if (sub.state !== SubscriptionState.Subscribed) {
      sub.subscribe();
    }
  }

  if (sub.state === SubscriptionState.Unsubscribed) {
    sub.subscribe();
  }

  try {
    await waitForSubscribed(sub);
  } catch (error) {
    if (handlerWasAdded) {
      handlers.delete(handler);
    }

    if (handlers.size === 0) {
      channelHandlers.delete(channel);
      removeSubscription(channel);
    }

    throw error;
  }

  return sub;
};

export const publish = async (
  channel: string,
  data: unknown
): Promise<PublishResult> => {
  const client = await getConnection();

  return client.publish(channel, data);
};

const removeSubscription = (channel: string): void => {
  const sub = channelSubscriptions.get(channel);
  if (!sub) {
    return;
  }

  subscriptionHandlerCleanups.get(sub)?.();
  subscriptionHandlerCleanups.delete(sub);

  if (sub.state !== SubscriptionState.Unsubscribed) {
    sub.unsubscribe();
  }
  channelSubscriptions.delete(channel);
};

export const unsubscribe = async (
  channel: string,
  handler?: (data: any, ctx: PublicationContext) => void
): Promise<void> => {
  if (!handler) {
    channelHandlers.delete(channel);
    removeSubscription(channel);
    return;
  }

  const handlers = channelHandlers.get(channel);
  if (!handlers) {
    return;
  }

  handlers.delete(handler);

  if (handlers.size > 0) {
    return;
  }

  channelHandlers.delete(channel);
  removeSubscription(channel);
};

export const isChannelSubscribed = (channel: string): boolean => {
  const sub = channelSubscriptions.get(channel);
  return sub !== undefined && sub.state === SubscriptionState.Subscribed;
};

export const addCentrifugoLifecycleListener = (
  listener: (event: CentrifugoLifecycleEvent) => void
): (() => void) => {
  lifecycleListeners.add(listener);

  return () => {
    lifecycleListeners.delete(listener);
  };
};

export const resetConnection = (): void => {
  clearActiveConnection();
  connectionPromise = null;
  tokenGenerationPromise = null;
  cachedToken = null;
  channelHandlers.clear();
  channelStreamPositions.clear();
  channelRecoveryStates.clear();
};

export const getStreamPosition = (
  channel: string
): { offset: number; epoch: string } | undefined => {
  return channelStreamPositions.get(channel);
};

export const clearStreamPosition = (channel: string): void => {
  channelStreamPositions.delete(channel);
};

export const fetchRecentHistoryAndProcess = async (
  channel: string,
  handler: (data: any, ctx: PublicationContext) => void,
  limit = 100,
  options: { commitCursor?: boolean } = {}
): Promise<number> => {
  const sub = channelSubscriptions.get(channel);

  if (!sub || sub.state !== SubscriptionState.Subscribed) {
    return 0;
  }

  const historyResult = await sub.history({ limit, reverse: true });
  const publications = [...(historyResult.publications ?? [])].sort((a, b) => {
    if (a.offset && b.offset) return a.offset - b.offset;
    if (a.offset) return -1;
    if (b.offset) return 1;
    return 0;
  });
  let processed = 0;

  for (const pub of publications) {
    try {
      handler(pub.data, pub as PublicationContext);
    } catch {
      if (options.commitCursor === false) {
        break;
      }
      const currentPosition = channelStreamPositions.get(channel);
      markRecoveryFailed(
        channel,
        {
          offset:
            typeof pub.offset === 'number'
              ? pub.offset
              : (currentPosition?.offset ?? 0),
          epoch: historyResult.epoch ?? currentPosition?.epoch ?? '',
        },
        'publication_handler_failed'
      );
      break;
    }

    if (options.commitCursor !== false && typeof pub.offset === 'number') {
      commitPublicationPosition(channel, pub.offset);
    }
    processed++;
  }

  return processed;
};

/**
 * Fetches history from a channel since the last known position.
 * The committed cursor only advances after a complete, contiguous history page
 * has been validated and every publication handler has succeeded.
 */
export const fetchHistoryAndProcess = async (
  channel: string
): Promise<HistoryProcessResult> => {
  const sub = channelSubscriptions.get(channel);

  if (!sub || sub.state !== SubscriptionState.Subscribed) {
    return {
      processed: 0,
      recovered: false,
      requiresFallback: true,
      reason: 'not_subscribed',
    };
  }

  const currentPosition = channelStreamPositions.get(channel);

  if (!currentPosition) {
    return {
      processed: 0,
      recovered: false,
      requiresFallback: true,
      reason: 'missing_position',
    };
  }

  try {
    const handlers = channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) {
      return {
        processed: 0,
        newOffset: currentPosition.offset,
        recovered: true,
        requiresFallback: false,
      };
    }

    const existingRecoveryHead = channelRecoveryStates.get(channel)?.head;
    channelRecoveryStates.set(channel, {
      head: existingRecoveryHead ?? currentPosition,
      cursorBlocked: true,
    });

    const publications: PublicationContext[] = [];
    let expectedOffset = currentPosition.offset;
    let targetOffset = currentPosition.offset;
    let currentSince = {
      offset: currentPosition.offset,
      epoch: currentPosition.epoch,
    };
    const FETCH_LIMIT = 100;
    const MAX_ITERATIONS = 10;

    let recoveryComplete = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const historyResult = await sub.history({
        limit: FETCH_LIMIT,
        since: currentSince,
      });

      const head = {
        offset: historyResult.offset,
        epoch: historyResult.epoch,
      };
      targetOffset = historyResult.offset;

      if (
        historyResult.epoch !== currentPosition.epoch ||
        targetOffset < expectedOffset
      ) {
        channelRecoveryStates.set(channel, {
          head,
          cursorBlocked: true,
        });
        return {
          processed: 0,
          recovered: false,
          requiresFallback: true,
          reason: 'history_gap',
        };
      }

      const orderedPublications = [...(historyResult.publications ?? [])]
        .filter(
          (
            publication
          ): publication is PublicationContext & { offset: number } =>
            typeof publication.offset === 'number'
        )
        .sort((left, right) => left.offset - right.offset);

      for (const publication of orderedPublications) {
        if (publication.offset <= expectedOffset) {
          continue;
        }

        if (publication.offset !== expectedOffset + 1) {
          channelRecoveryStates.set(channel, {
            head,
            cursorBlocked: true,
          });
          return {
            processed: 0,
            recovered: false,
            requiresFallback: true,
            reason: 'history_gap',
          };
        }

        publications.push(publication);
        expectedOffset = publication.offset;
      }

      if (expectedOffset === targetOffset) {
        recoveryComplete = true;
        break;
      }

      currentSince = {
        offset: expectedOffset,
        epoch: historyResult.epoch,
      };

      if (orderedPublications.length === 0) {
        break;
      }
    }

    if (!recoveryComplete) {
      channelRecoveryStates.set(channel, {
        head: {
          offset: targetOffset,
          epoch: currentPosition.epoch,
        },
        cursorBlocked: true,
      });
      return {
        processed: 0,
        recovered: false,
        requiresFallback: true,
        reason: 'history_gap',
      };
    }

    for (const publication of publications) {
      if (!processPublicationThroughHandlers(publication, handlers)) {
        channelRecoveryStates.set(channel, {
          head: {
            offset: targetOffset,
            epoch: currentPosition.epoch,
          },
          cursorBlocked: true,
        });
        return {
          processed: 0,
          recovered: false,
          requiresFallback: true,
          reason: 'handler_failed',
        };
      }
    }

    channelStreamPositions.set(channel, {
      offset: targetOffset,
      epoch: currentPosition.epoch,
    });
    channelRecoveryStates.delete(channel);

    return {
      processed: publications.length,
      newOffset: targetOffset,
      recovered: true,
      requiresFallback: false,
    };
  } catch {
    try {
      const head = await sub.history({ limit: 0 });
      channelRecoveryStates.set(channel, {
        head: { offset: head.offset, epoch: head.epoch },
        cursorBlocked: true,
      });
    } catch {}

    return {
      processed: 0,
      recovered: false,
      requiresFallback: true,
      reason: 'history_unavailable',
    };
  }
};

/**
 * Marks the stream head captured before an authoritative API reload as the new
 * baseline. A subsequent history pass must still run to cover publications
 * that arrived while the API request was in flight.
 */
export const acknowledgeRecoveryFallback = (channel: string): boolean => {
  const recoveryState = channelRecoveryStates.get(channel);
  if (!recoveryState?.cursorBlocked) {
    return false;
  }

  channelStreamPositions.set(channel, recoveryState.head);
  channelRecoveryStates.delete(channel);
  return true;
};
