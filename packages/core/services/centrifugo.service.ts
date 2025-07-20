import { injectable, inject } from 'tsyringe';
import {
  Centrifuge,
  PublicationContext,
  Subscription,
  SubscriptionState,
  State,
} from 'centrifuge';

@injectable()
export class CentrifugoService {
  constructor(@inject('Centrifuge') private readonly client: Centrifuge) {}

  private waitForConnected(): Promise<void> {
    if (this.client.state === State.Connected) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const handler = () => {
        this.client.off('connected', handler);

        resolve();
      };

      this.client.on('connected', handler);
    });
  }

  async onMessage(
    channel: string,
    handler: (data: unknown, ctx: PublicationContext) => void
  ): Promise<Subscription> {
    await this.waitForConnected();

    const sub =
      this.client.getSubscription(channel) ??
      this.client.newSubscription(channel);

    sub.on('publication', (ctx: PublicationContext) => {
      handler(ctx.data, ctx);
    });

    if (sub.state !== SubscriptionState.Subscribed) {
      sub.subscribe();
    }

    return sub;
  }

  async publish(channel: string, data: unknown): Promise<void> {
    await this.waitForConnected();

    try {
      await this.client.publish(channel, data);
    } catch (err) {
      throw err;
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.waitForConnected();

    const sub = this.client.getSubscription(channel);

    if (sub && sub.state !== SubscriptionState.Unsubscribed) {
      sub.unsubscribe();
    }
  }
}
