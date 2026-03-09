import {
  Centrifuge,
  type PublishResult,
  type PublicationContext,
  type SubscribedContext,
  State,
  type Subscription,
  SubscriptionState,
} from 'centrifuge';
import { BACKEND_URL } from '../config';
import { getToken } from '../storage/authStorage';
import { teardownMobileSessionOnUnauthorized } from '../utils/sessionTeardown';

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
let tokenGenerationPromise: Promise<AuthTokenResponse> | null = null;
let cachedToken: { token: string; url: string; expiresAt: number } | null =
  null;

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

const requestCentrifugoAuthToken = async (): Promise<AuthTokenResponse> => {
  const token = await getToken();
  if (!token || !BACKEND_URL) {
    throw new Error('Unable to request Centrifugo token');
  }

  const response = await fetch(`${BACKEND_URL}${CENTRIFUGO_AUTH_TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'pt',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{}',
  });

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

const generateTokenAndUrl = async (): Promise<AuthTokenResponse> => {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + TOKEN_CACHE_MARGIN_MS) {
    return { token: cachedToken.token, url: cachedToken.url };
  }

  if (tokenGenerationPromise) {
    return tokenGenerationPromise;
  }

  tokenGenerationPromise = (async () => {
    try {
      const response = await requestCentrifugoAuthToken();

      cachedToken = {
        token: response.token,
        url: response.url,
        expiresAt: now + 24 * 60 * 60 * 1000,
      };

      return response;
    } finally {
      tokenGenerationPromise = null;
    }
  })();

  return tokenGenerationPromise;
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

    const onDisconnected = (): void => {};

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

const getConnection = async (): Promise<Centrifuge> => {
  if (centrifugeClient) {
    const state = centrifugeClient.state;

    if (state === State.Connected) {
      return centrifugeClient;
    }

    if (state === State.Disconnected) {
      try {
        centrifugeClient.disconnect();
      } catch {
        //
      }
      centrifugeClient = null;
    } else {
      try {
        await waitForConnected(centrifugeClient);
        return centrifugeClient;
      } catch {
        try {
          centrifugeClient.disconnect();
        } catch {
          //
        }
        centrifugeClient = null;
      }
    }
  }

  const { token, url: wsUrl } = await generateTokenAndUrl();

  centrifugeClient = new Centrifuge(`${wsUrl}/connection/websocket`, {
    token,
    getToken: async () => generateToken(),
    timeout: 30000,
    maxServerPingDelay: 60000,
    minReconnectDelay: 1000,
    maxReconnectDelay: 10000,
  });

  centrifugeClient.on('disconnected', (ctx) => {
    if (ctx.reason !== 'clean' && ctx.code !== 1000) {
      setTimeout(() => {
        if (centrifugeClient && centrifugeClient.state === State.Disconnected) {
          centrifugeClient.connect();
        }
      }, 1000);
    }
  });

  centrifugeClient.on('error', () => {
    //
  });

  centrifugeClient.connect();

  try {
    await waitForConnected(centrifugeClient);
  } catch (error) {
    try {
      centrifugeClient.disconnect();
    } catch {
      //
    }
    centrifugeClient = null;
    throw error;
  }

  return centrifugeClient;
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

  if (handlers.has(handler)) {
    const existingSub = channelSubscriptions.get(channel);
    if (existingSub) {
      return existingSub;
    }
  }

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

    sub.on('publication', (ctx) => {
      const handlersForChannel = channelHandlers.get(channel);
      if (handlersForChannel) {
        for (const h of handlersForChannel) {
          try {
            h(ctx.data, ctx);
          } catch {
            //
          }
        }
      }
    });

    sub.on('subscribed', (ctx: SubscribedContext) => {
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
            //
          }
        }
      }
    });

    if (sub.state !== SubscriptionState.Subscribed) {
      sub.subscribe();
    }
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

export const resetConnection = (): void => {
  if (centrifugeClient) {
    try {
      centrifugeClient.disconnect();
    } catch {
      //
    }
    centrifugeClient = null;
  }
  tokenGenerationPromise = null;
  cachedToken = null;
  channelHandlers.clear();
  channelSubscriptions.clear();
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
