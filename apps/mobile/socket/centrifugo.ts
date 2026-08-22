import {
  Centrifuge,
  type DisconnectedContext,
  type PublishResult,
  type PublicationContext,
  type SubscribedContext,
  State,
  type Subscription,
  SubscriptionState,
} from 'centrifuge';
import { BACKEND_URL } from '../config';
import { getToken, getUser } from '../storage/authStorage';
import { teardownMobileSessionOnUnauthorized } from '../utils/sessionTeardown';
import { refreshSessionTokenWithSingleFlight } from '../api/sessionRefresh';

export type { Subscription };

type AuthTokenResponse = {
  token: string;
  url: string;
};

type ApiEnvelope<T> = {
  status?: boolean;
  data?: T;
};

let centrifugeClient: Centrifuge | null = null;
let connectionAuthKey: string | null = null;
let connectionGeneration = 0;
let connectionPromise: {
  authKey: string;
  promise: Promise<Centrifuge>;
} | null = null;
let tokenGeneration = 0;
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
const CENTRIFUGO_AUTH_TOKEN_PATH = '/v1/centrifugo/auth/token';

const channelHandlers = new Map<
  string,
  Set<(data: unknown, ctx: PublicationContext) => void>
>();
const channelSubscriptions = new Map<string, Subscription>();
const channelStreamPositions = new Map<
  string,
  { offset: number; epoch: string }
>();
const recoveryFailedListeners = new Set<(channel: string) => void>();
const connectionListeners = new Set<(connected: boolean) => void>();
const subscriptionHandlerCleanups = new WeakMap<Subscription, () => void>();
const clientHandlerCleanups = new WeakMap<Centrifuge, () => void>();

const clearCachedToken = (): void => {
  tokenGeneration += 1;
  cachedToken = null;
  tokenGenerationPromise = null;
};

const getStringField = (
  value: Record<string, unknown> | null,
  field: string
): string | null => {
  const candidate = value?.[field];
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
};

/**
 * Keeps connection/token single-flight state scoped to the authenticated
 * account. The raw bearer is only used as an in-memory fallback while the
 * persisted user record is being established and is never logged.
 */
const getRealtimeAuthKey = async (): Promise<string> => {
  const user = await getUser().catch(() => null);
  const accountId = getStringField(user, 'account_id');
  const userId = getStringField(user, 'user_id') ?? getStringField(user, 'id');
  if (accountId) return `${accountId}:${userId ?? ''}`;

  const token = await getToken();
  return token ? `token:${token}` : ':';
};

const isTokenExpiredSignal = (code: number, reason: string): boolean => {
  if (code === 109 || code === 3501) {
    return true;
  }

  return reason.toLowerCase().includes('token expired');
};

const emitConnectionState = (connected: boolean): void => {
  for (const listener of connectionListeners) {
    try {
      listener(connected);
    } catch {
      // ignore listener errors
    }
  }
};

const requestCentrifugoAuthToken = async (
  tokenOverride?: string
): Promise<Response> => {
  const token = tokenOverride ?? (await getToken());

  if (!token || !BACKEND_URL) {
    throw new Error('Unable to request Centrifugo token');
  }

  return fetch(`${BACKEND_URL}${CENTRIFUGO_AUTH_TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'pt',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Client-Platform': 'mobile',
    },
    body: '{}',
  });
};

const requestCentrifugoAuthTokenWithRetry =
  async (): Promise<AuthTokenResponse> => {
    let response = await requestCentrifugoAuthToken();

    if (response.status === 401) {
      const refreshedToken = await refreshSessionTokenWithSingleFlight();

      if (refreshedToken) {
        response = await requestCentrifugoAuthToken(refreshedToken);
      }
    }

    if (response.status === 401) {
      await teardownMobileSessionOnUnauthorized();
      throw new Error('Unauthorized Centrifugo token request');
    }

    if (!response.ok) {
      throw new Error('Failed to request Centrifugo token');
    }

    const payload = (await response.json()) as ApiEnvelope<AuthTokenResponse>;
    const authData = payload?.data;
    if (!payload?.status || !authData?.token || !authData?.url) {
      throw new Error('Invalid Centrifugo auth response');
    }

    return authData;
  };

const generateTokenAndUrl = async (
  expectedAuthKey?: string
): Promise<AuthTokenResponse> => {
  const now = Date.now();
  const authKey = expectedAuthKey ?? (await getRealtimeAuthKey());

  if (authKey !== (await getRealtimeAuthKey())) {
    throw new Error('Centrifugo auth context changed');
  }

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

  const generation = ++tokenGeneration;
  const promise = (async () => {
    const response = await requestCentrifugoAuthTokenWithRetry();
    if (
      generation !== tokenGeneration ||
      authKey !== (await getRealtimeAuthKey())
    ) {
      throw new Error('Centrifugo auth context changed');
    }

    cachedToken = {
      token: response.token,
      url: response.url,
      expiresAt: now + 24 * 60 * 60 * 1000,
      authKey,
    };

    return response;
  })();
  const pending = { authKey, promise };
  tokenGenerationPromise = pending;
  void promise.then(
    () => {
      if (tokenGenerationPromise === pending) tokenGenerationPromise = null;
    },
    () => {
      if (tokenGenerationPromise === pending) tokenGenerationPromise = null;
    }
  );

  return promise;
};

const generateToken = async (authKey?: string): Promise<string> => {
  const tokenData = await generateTokenAndUrl(authKey);
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

    const cleanup = (): void => {
      sub.off('subscribed', onSubscribed);
      sub.off('unsubscribed', onUnsubscribed);
      sub.off('error', onError);
      if (timer) clearTimeout(timer);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onSubscribed = (): void => settle(resolve);
    const onUnsubscribed = (ctx: { reason?: string }): void =>
      settle(() =>
        reject(new Error(ctx.reason || 'Centrifugo subscription closed'))
      );
    const onError = (ctx: unknown): void =>
      settle(() =>
        reject(ctx instanceof Error ? ctx : new Error(String(ctx)))
      );

    sub.on('subscribed', onSubscribed);
    sub.on('unsubscribed', onUnsubscribed);
    sub.on('error', onError);
    timer = setTimeout(
      () => settle(() => reject(new Error('Subscription timeout'))),
      timeoutMs
    );

    if (sub.state === SubscriptionState.Unsubscribed) {
      sub.subscribe();
    }
  });
};

const disconnectClient = (client: Centrifuge): void => {
  clientHandlerCleanups.get(client)?.();
  clientHandlerCleanups.delete(client);
  try {
    client.disconnect();
  } catch {
    // ignore teardown errors from a retired client
  }
};

const clearActiveConnection = (
  client: Centrifuge | null = centrifugeClient
): void => {
  if (client && centrifugeClient !== client) {
    disconnectClient(client);
    return;
  }

  connectionGeneration += 1;
  if (client) disconnectClient(client);
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
    if (centrifugeClient === client) emitConnectionState(true);
  };
  const onDisconnected = (ctx: DisconnectedContext): void => {
    if (centrifugeClient !== client) return;
    emitConnectionState(false);
    if (isTokenExpiredSignal(ctx.code, ctx.reason)) clearCachedToken();
    // Centrifuge owns its bounded reconnect loop. A second, untracked timer
    // here could reconnect a retired account/client after logout.
  };
  const onError = (ctx: unknown): void => {
    if (centrifugeClient !== client || !ctx || typeof ctx !== 'object') return;
    const payload = ctx as { code?: unknown; message?: unknown };
    const code =
      typeof payload.code === 'number' && Number.isFinite(payload.code)
        ? payload.code
        : 0;
    const reason =
      typeof payload.message === 'string' ? payload.message : 'unknown';
    if (isTokenExpiredSignal(code, reason)) clearCachedToken();
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

const createConnection = async (
  authKey: string,
  generation: number
): Promise<Centrifuge> => {
  const { token, url: wsUrl } = await generateTokenAndUrl(authKey);
  if (
    generation !== connectionGeneration ||
    authKey !== (await getRealtimeAuthKey())
  ) {
    throw new Error('Centrifugo auth context changed');
  }

  const client = new Centrifuge(`${wsUrl}/connection/websocket`, {
    token,
    getToken: async () => generateToken(authKey),
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

  if (
    generation !== connectionGeneration ||
    centrifugeClient !== client ||
    authKey !== (await getRealtimeAuthKey())
  ) {
    clearActiveConnection(client);
    throw new Error('Centrifugo auth context changed');
  }

  return client;
};

const getOrCreateConnection = (authKey: string): Promise<Centrifuge> => {
  if (connectionPromise?.authKey === authKey) {
    return connectionPromise.promise;
  }

  const generation = ++connectionGeneration;
  const promise = createConnection(authKey, generation);
  const pending = { authKey, promise };
  connectionPromise = pending;
  void promise.then(
    () => {
      if (connectionPromise === pending) connectionPromise = null;
    },
    () => {
      if (connectionPromise === pending) connectionPromise = null;
    }
  );
  return promise;
};

const getConnection = async (): Promise<Centrifuge> => {
  const authKey = await getRealtimeAuthKey();

  if (connectionPromise?.authKey === authKey) {
    return connectionPromise.promise;
  }

  if (centrifugeClient && connectionAuthKey !== authKey) {
    clearActiveConnection(centrifugeClient);
  }

  const client = centrifugeClient;
  if (!client) return getOrCreateConnection(authKey);
  if (client.state === State.Connected) return client;

  if (client.state === State.Disconnected) {
    clearActiveConnection(client);
    return getOrCreateConnection(authKey);
  }

  try {
    await waitForConnected(client);
    if (
      centrifugeClient !== client ||
      connectionAuthKey !== authKey ||
      authKey !== (await getRealtimeAuthKey())
    ) {
      throw new Error('Centrifugo auth context changed');
    }
    return client;
  } catch {
    clearActiveConnection(client);
    return getOrCreateConnection(authKey);
  }
};

const setupSubscriptionHandlers = (
  sub: Subscription,
  channel: string
): void => {
  if (subscriptionHandlerCleanups.has(sub)) return;

  const onPublication = (ctx: PublicationContext): void => {
    const handlersForChannel = channelHandlers.get(channel);
    if (!handlersForChannel) return;
    for (const handler of handlersForChannel) {
      try {
        handler(ctx.data, ctx);
      } catch {
        // isolate consumer failures from the shared realtime transport
      }
    }
  };
  const onSubscribed = (ctx: SubscribedContext): void => {
    if (ctx.streamPosition) {
      channelStreamPositions.set(channel, {
        offset: ctx.streamPosition.offset,
        epoch: ctx.streamPosition.epoch,
      });
    }
    if (ctx.wasRecovering && !ctx.recovered) {
      for (const listener of recoveryFailedListeners) {
        try {
          listener(channel);
        } catch {
          // isolate recovery observers
        }
      }
    }
  };

  sub.on('publication', onPublication);
  sub.on('subscribed', onSubscribed);
  subscriptionHandlerCleanups.set(sub, () => {
    sub.off('publication', onPublication);
    sub.off('subscribed', onSubscribed);
  });
};

export const onMessage = async (
  channel: string,
  handler: (data: unknown, ctx: PublicationContext) => void
): Promise<Subscription> => {
  const client = await getConnection();

  let handlers = channelHandlers.get(channel);
  if (!handlers) {
    handlers = new Set();
    channelHandlers.set(channel, handlers);
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
  }

  setupSubscriptionHandlers(sub, channel);
  try {
    // Resolves only after Centrifugo confirms `Subscribed`, closing the
    // subscription -> HTTP bootstrap gap for every mobile consumer.
    await waitForSubscribed(sub);
  } catch (error) {
    if (handlerWasAdded) handlers.delete(handler);
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
  handler?: (data: unknown, ctx: PublicationContext) => void
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

export const addCentrifugoRecoveryFailedListener = (
  listener: (channel: string) => void
): (() => void) => {
  recoveryFailedListeners.add(listener);
  return () => {
    recoveryFailedListeners.delete(listener);
  };
};

export const addCentrifugoConnectionListener = (
  listener: (connected: boolean) => void,
  options?: { emitCurrent?: boolean }
): (() => void) => {
  connectionListeners.add(listener);

  if (options?.emitCurrent) {
    listener(centrifugeClient?.state === State.Connected);
  }

  return () => {
    connectionListeners.delete(listener);
  };
};

export const isCentrifugoConnected = (): boolean => {
  return centrifugeClient?.state === State.Connected;
};

export const resetConnection = (): void => {
  emitConnectionState(false);
  clearActiveConnection();
  connectionPromise = null;
  clearCachedToken();
  channelHandlers.clear();
  channelStreamPositions.clear();
};

export const getStreamPosition = (
  channel: string
): { offset: number; epoch: string } | undefined => {
  return channelStreamPositions.get(channel);
};

export const clearStreamPosition = (channel: string): void => {
  channelStreamPositions.delete(channel);
};
