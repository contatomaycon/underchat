import {
  Centrifuge,
  PublicationContext,
  State,
  SubscriptionState,
} from 'centrifuge';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

export interface ExternalConnectionCentrifugoConfig {
  url: string;
  connectionToken: string;
  subscriptionToken: string;
  channel: string;
}

export type ExternalConnectionMessageHandler = (
  data: IBaileysConnectionState,
  ctx: PublicationContext
) => void;

export type ExternalConnectionSubscriptionCleanup = () => void;

export async function subscribeExternalConnection(
  config: ExternalConnectionCentrifugoConfig,
  handler: ExternalConnectionMessageHandler
): Promise<ExternalConnectionSubscriptionCleanup> {
  const client = new Centrifuge(`${config.url}/connection/websocket`, {
    websocket: WebSocket,
    token: config.connectionToken,
    getToken: async () => config.connectionToken,
    timeout: 30000,
    maxServerPingDelay: 60000,
    minReconnectDelay: 1000,
    maxReconnectDelay: 10000,
  });
  const subscription = client.newSubscription(config.channel, {
    token: config.subscriptionToken,
    getToken: async () => config.subscriptionToken,
    recoverable: true,
  });

  subscription.on('publication', (ctx) => {
    handler(ctx.data as IBaileysConnectionState, ctx);
  });

  const cleanup = (): void => {
    if (subscription.state !== SubscriptionState.Unsubscribed) {
      subscription.unsubscribe();
    }

    if (client.state !== State.Disconnected) {
      client.disconnect();
    }
  };

  const subscribed = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('External connection subscription timeout'));
    }, 15000);

    const clear = (): void => {
      window.clearTimeout(timeout);
      subscription.off('subscribed', onSubscribed);
      subscription.off('error', onSubscriptionError);
      client.off('error', onClientError);
    };

    const onSubscribed = (): void => {
      clear();
      resolve();
    };

    const onSubscriptionError = (error: unknown): void => {
      clear();
      reject(error);
    };

    const onClientError = (error: unknown): void => {
      clear();
      reject(error);
    };

    subscription.on('subscribed', onSubscribed);
    subscription.on('error', onSubscriptionError);
    client.on('error', onClientError);
  });

  client.connect();
  subscription.subscribe();

  try {
    await subscribed;
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}
