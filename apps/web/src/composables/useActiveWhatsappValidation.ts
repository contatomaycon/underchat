import {
  Centrifuge,
  State,
  SubscriptionState,
  type PublicationContext,
  type Subscription,
} from 'centrifuge';
import type { IActiveWhatsappValidationPublication } from '@core/common/interfaces/IActiveWhatsappValidation';

export type ActiveWhatsappValidationHandler = (
  data: IActiveWhatsappValidationPublication,
  ctx: PublicationContext
) => void;

export interface ActiveWhatsappValidationConfig {
  centrifugoUrl: string;
  centrifugoToken: string;
  centrifugoChannel: string;
}

export function useActiveWhatsappValidation() {
  let client: Centrifuge | null = null;
  let subscription: Subscription | null = null;

  const cleanup = (): void => {
    if (subscription && subscription.state !== SubscriptionState.Unsubscribed) {
      subscription.unsubscribe();
    }

    if (client && client.state !== State.Disconnected) {
      client.disconnect();
    }

    subscription = null;
    client = null;
  };

  const subscribe = async (
    config: ActiveWhatsappValidationConfig,
    handler: ActiveWhatsappValidationHandler
  ): Promise<void> => {
    cleanup();

    client = new Centrifuge(`${config.centrifugoUrl}/connection/websocket`, {
      websocket: WebSocket,
      token: config.centrifugoToken,
      getToken: async () => config.centrifugoToken,
      timeout: 30000,
      maxServerPingDelay: 60000,
      minReconnectDelay: 1000,
      maxReconnectDelay: 10000,
    });

    subscription = client.newSubscription(config.centrifugoChannel, {
      recoverable: true,
    });

    subscription.on('publication', (ctx) => {
      handler(ctx.data as IActiveWhatsappValidationPublication, ctx);
    });

    const subscribed = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Active WhatsApp validation subscription timeout'));
      }, 15000);

      let clear = (): void => undefined;

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

      clear = (): void => {
        window.clearTimeout(timeout);
        subscription?.off('subscribed', onSubscribed);
        subscription?.off('error', onSubscriptionError);
        client?.off('error', onClientError);
      };

      subscription?.on('subscribed', onSubscribed);
      subscription?.on('error', onSubscriptionError);
      client?.on('error', onClientError);
    });

    client.connect();
    subscription.subscribe();

    try {
      await subscribed;
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  return {
    subscribe,
    cleanup,
  };
}
