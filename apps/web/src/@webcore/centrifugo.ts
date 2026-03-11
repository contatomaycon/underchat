import {
  Centrifuge,
  PublicationContext,
  State,
  Subscription,
  SubscriptionState,
  PublishResult,
  SubscribedContext,
} from 'centrifuge';
import { isAxiosError } from 'axios';
import axios, { logoutAndRedirect } from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { AuthTokenResponse } from '@core/schema/centrifugo/token/response.schema';
import { getCentrifugoTelemetry } from './centrifugoTelemetry';

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

const telemetry = getCentrifugoTelemetry();
telemetry.setStreamPositionProvider(() => channelStreamPositions);

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
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        await logoutAndRedirect();
      }

      throw error;
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

/**
 * Sets up publication, subscribed, and unsubscribed event handlers on a subscription.
 * Extracted as helper to reuse in both onMessage() and reconnection re-subscription.
 */
const setupSubscriptionHandlers = (
  sub: Subscription,
  channel: string
): void => {
  sub.on('publication', (ctx) => {
    // BUG 2 FIX: Update stream position on every publication
    if (ctx.offset) {
      const currentPos = channelStreamPositions.get(channel);
      if (!currentPos || ctx.offset > currentPos.offset) {
        channelStreamPositions.set(channel, {
          offset: ctx.offset,
          epoch: currentPos?.epoch ?? '',
        });
      }
    }

    telemetry.trackPublication(channel);

    const handlersForChannel = channelHandlers.get(channel);
    if (handlersForChannel) {
      for (const h of handlersForChannel) {
        try {
          h(ctx.data, ctx);
          telemetry.trackPublicationProcessed(channel);
        } catch (error) {
          telemetry.trackPublicationDropped(channel, error);
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
      telemetry.trackSubscription(channel, 'recovered', {
        recovered: true,
        wasRecovering: true,
      });
      if (import.meta.env.DEV) {
        console.info(`[Centrifugo] Channel ${channel} recovered successfully`);
      }
    } else if (ctx.wasRecovering && !ctx.recovered) {
      telemetry.trackSubscription(channel, 'recovery_failed', {
        recovered: false,
        wasRecovering: true,
      });
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
    } else {
      telemetry.trackSubscription(channel, 'subscribed');
    }
  });

  sub.on('unsubscribed', () => {
    telemetry.trackSubscription(channel, 'unsubscribed');
    if (import.meta.env.DEV) {
      console.info(`[Centrifugo] Unsubscribed from ${channel}`);
    }
  });
};

/**
 * BUG 4 FIX: Re-subscribe all channels that had active handlers after creating a new client.
 * This ensures no messages are lost when the connection is recreated.
 */
const resubscribeActiveChannels = (client: Centrifuge): void => {
  const channelsToResubscribe = Array.from(channelHandlers.keys());

  for (const channel of channelsToResubscribe) {
    const handlers = channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) continue;

    // Skip if already subscribed on this client
    const existingSub = client.getSubscription(channel);
    if (existingSub && existingSub.state === SubscriptionState.Subscribed) {
      channelSubscriptions.set(channel, existingSub);
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

const getConnection = async (): Promise<Centrifuge> => {
  if (centrifugeClient) {
    const state = centrifugeClient.state;

    if (state === State.Connected) {
      return centrifugeClient;
    }

    if (state === State.Disconnected) {
      try {
        centrifugeClient.disconnect();
      } catch (error) {
        telemetry.trackError('disconnect_cleanup', error);
      }
      centrifugeClient = null;
      // BUG 4 FIX: Clear stale subscription references
      channelSubscriptions.clear();
    } else {
      try {
        await waitForConnected(centrifugeClient);
        return centrifugeClient;
      } catch (error) {
        telemetry.trackError('wait_for_connected', error);
        try {
          centrifugeClient.disconnect();
        } catch (disconnectError) {
          telemetry.trackError('disconnect_after_wait_fail', disconnectError);
        }
        centrifugeClient = null;
        // BUG 4 FIX: Clear stale subscription references
        channelSubscriptions.clear();
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
        telemetry.trackError('token_refresh', error);
        throw error;
      }
    },
    timeout: 30000,
    maxServerPingDelay: 60000,
    minReconnectDelay: 1000,
    maxReconnectDelay: 10000,
  });

  centrifugeClient.on('connected', () => {
    telemetry.trackConnectionState('connected');
  });

  centrifugeClient.on('disconnected', (ctx) => {
    telemetry.trackConnectionState('disconnected', ctx.reason, ctx.code);

    if (ctx.reason !== 'clean' && ctx.code !== 1000) {
      setTimeout(() => {
        if (centrifugeClient && centrifugeClient.state === State.Disconnected) {
          centrifugeClient.connect();
        }
      }, 1000);
    }
  });

  centrifugeClient.on('error', (error) => {
    telemetry.trackConnectionState('error', String(error));
    if (import.meta.env.DEV) {
      console.error('Centrifugo client error:', error);
    }
  });

  centrifugeClient.connect();

  try {
    await waitForConnected(centrifugeClient);
  } catch (error) {
    telemetry.trackError('initial_connection', error);
    try {
      centrifugeClient.disconnect();
    } catch (disconnectError) {
      telemetry.trackError('disconnect_after_init_fail', disconnectError);
    }
    centrifugeClient = null;
    throw error;
  }

  // BUG 4 FIX: Re-subscribe channels that had handlers on previous connection
  resubscribeActiveChannels(centrifugeClient);

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

    setupSubscriptionHandlers(sub, channel);

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
    } catch (error) {
      telemetry.trackError('reset_connection_disconnect', error);
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

const processPublicationThroughHandlers = (
  pub: { data: unknown; offset?: number },
  handlers: Set<(data: any, ctx: PublicationContext) => void>,
  channel: string
): void => {
  for (const handler of handlers) {
    try {
      handler(pub.data, pub as PublicationContext);
    } catch (error) {
      telemetry.trackError('history_publication_handler', error, channel);
    }
  }
};

/**
 * Fetches history from a channel since the last known position.
 * Returns publications that were missed and processes them through handlers.
 * BUG 3 FIX: Now paginates through all missed messages instead of fetching only 100.
 */
export const fetchHistoryAndProcess = async (
  channel: string
): Promise<{ processed: number; newOffset?: number }> => {
  const sub = channelSubscriptions.get(channel);

  if (!sub || sub.state !== SubscriptionState.Subscribed) {
    return { processed: 0 };
  }

  const currentPosition = channelStreamPositions.get(channel);

  if (!currentPosition) {
    return { processed: 0 };
  }

  const startTime = Date.now();

  try {
    const handlers = channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) {
      return { processed: 0 };
    }

    let totalProcessed = 0;
    let maxOffset = currentPosition.offset;
    let currentSince = {
      offset: currentPosition.offset,
      epoch: currentPosition.epoch,
    };
    const FETCH_LIMIT = 100;
    const MAX_ITERATIONS = 10;
    let pages = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const historyResult = await sub.history({
        limit: FETCH_LIMIT,
        since: currentSince,
      });

      if (
        !historyResult.publications ||
        historyResult.publications.length === 0
      ) {
        break;
      }

      pages++;

      for (const pub of historyResult.publications) {
        if (!pub.offset || pub.offset <= currentSince.offset) {
          continue;
        }

        processPublicationThroughHandlers(pub, handlers, channel);

        if (pub.offset > maxOffset) {
          maxOffset = pub.offset;
        }
      }

      currentSince = {
        offset: maxOffset,
        epoch: historyResult.epoch || currentPosition.epoch,
      };

      totalProcessed += historyResult.publications.length;

      if (historyResult.publications.length < FETCH_LIMIT) {
        break;
      }
    }

    if (maxOffset > currentPosition.offset) {
      channelStreamPositions.set(channel, {
        offset: maxOffset,
        epoch: currentSince.epoch,
      });
    }

    const durationMs = Date.now() - startTime;
    telemetry.trackHistorySync(channel, totalProcessed, pages, durationMs);

    return {
      processed: totalProcessed,
      newOffset: maxOffset,
    };
  } catch (error) {
    telemetry.trackError('fetch_history', error, channel);
    if (import.meta.env.DEV) {
      console.error(`[Centrifugo] History fetch failed for ${channel}:`, error);
    }
    return { processed: 0 };
  }
};
