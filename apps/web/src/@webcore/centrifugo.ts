import {
  Centrifuge,
  PublicationContext,
  State,
  Subscription,
  SubscriptionState,
  PublishResult,
  SubscribedContext,
} from 'centrifuge';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { AuthTokenResponse } from '@core/schema/centrifugo/token/response.schema';

export type { Subscription };

let centrifugeClient: Centrifuge | null = null;
let tokenGenerationPromise: Promise<AuthTokenResponse> | null = null;
let cachedToken: { token: string; url: string; expiresAt: number } | null =
  null;
const TOKEN_CACHE_MARGIN_MS = 5 * 60 * 1000;
const channelHandlers = new Map<
  string,
  Set<(data: any, ctx: PublicationContext) => void>
>();
const channelSubscriptions = new Map<string, Subscription>();
const channelStreamPositions = new Map<
  string,
  { offset: number; epoch: string }
>();

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
      const response = await axios.post<IApiResponse<AuthTokenResponse>>(
        `/centrifugo/auth/token`
      );

      const data = response?.data;

      if (!data?.status) {
        throw new Error(data?.message ?? 'Failed to generate Centrifugo token');
      }

      cachedToken = {
        token: data.data.token,
        url: data.data.url,
        expiresAt: now + 24 * 60 * 60 * 1000,
      };

      return data.data;
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
      } catch {}
      centrifugeClient = null;
    } else {
      try {
        await waitForConnected(centrifugeClient);
        return centrifugeClient;
      } catch {
        try {
          centrifugeClient.disconnect();
        } catch {}
        centrifugeClient = null;
      }
    }
  }

  const { token, url: wsUrl } = await generateTokenAndUrl();

  centrifugeClient = new Centrifuge(`${wsUrl}/connection/websocket`, {
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

  centrifugeClient.on('disconnected', (ctx) => {
    if (ctx.reason !== 'clean' && ctx.code !== 1000) {
      setTimeout(() => {
        if (centrifugeClient && centrifugeClient.state === State.Disconnected) {
          centrifugeClient.connect();
        }
      }, 1000);
    }
  });

  centrifugeClient.on('error', (error) => {
    if (import.meta.env.DEV) {
      console.error('Centrifugo client error:', error);
    }
  });

  centrifugeClient.connect();

  try {
    await waitForConnected(centrifugeClient);
  } catch (error) {
    try {
      centrifugeClient.disconnect();
    } catch {}
    centrifugeClient = null;
    throw error;
  }

  return centrifugeClient;
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
          } catch (error) {
            if (import.meta.env.DEV) {
              console.error('Error in Centrifugo handler:', error, { channel });
            }
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

      if (ctx.wasRecovering && ctx.recovered) {
        if (import.meta.env.DEV) {
          console.info(
            `[Centrifugo] Channel ${channel} recovered successfully`
          );
        }
      } else if (ctx.wasRecovering && !ctx.recovered) {
        if (import.meta.env.DEV) {
          console.warn(
            `[Centrifugo] Channel ${channel} recovery failed, may have missed messages`
          );
        }
        globalThis.dispatchEvent(
          new CustomEvent('centrifugo-recovery-failed', {
            detail: { channel },
          })
        );
      }
    });

    sub.on('unsubscribed', () => {
      if (import.meta.env.DEV) {
        console.info(`[Centrifugo] Unsubscribed from ${channel}`);
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

export const resetConnection = (): void => {
  if (centrifugeClient) {
    try {
      centrifugeClient.disconnect();
    } catch {}
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
