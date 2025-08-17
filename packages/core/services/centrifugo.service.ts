import { injectable, inject } from 'tsyringe';
import {
  Centrifuge,
  PublicationContext,
  PublishResult,
  State,
  Subscription,
  SubscriptionState,
} from 'centrifuge';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { centrifugoEnvironment } from '@core/config/environments';

@injectable()
export class CentrifugoService {
  constructor(@inject('Centrifuge') private readonly client: Centrifuge) {}

  private async waitForConnected(): Promise<void> {
    if (this.client.state === State.Connected) {
      return;
    }

    await new Promise<void>((resolve) => {
      const handler = () => {
        this.client.off('connected', handler);
        resolve();
      };

      this.client.on('connected', handler);
    });
  }

  private generateSubToken(subId: string): string {
    const exp = Math.floor(Date.now() / 1000) + 5;

    return jwt.sign(
      { sub: subId, exp },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  }

  private async publishWithToken(
    token: string,
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    const tempClient = new Centrifuge(
      `${centrifugoEnvironment.centrifugoWsUrl}/connection/websocket`,
      {
        websocket: WebSocket,
        token,
        timeout: 30_000,
        maxServerPingDelay: 60_000,
      }
    );

    await new Promise<void>((resolve, reject) => {
      const toError = (e: unknown): Error => {
        if (e instanceof Error) return e;
        if (typeof e === 'string') return new Error(e);

        try {
          return new Error(JSON.stringify(e));
        } catch {
          return new Error(String(e));
        }
      };

      const onConnect = () => {
        tempClient.off('connected', onConnect);
        tempClient.off('error', onError);
        resolve();
      };

      const onError = (err: unknown) => {
        tempClient.off('connected', onConnect);
        tempClient.off('error', onError);
        reject(toError(err));
      };

      tempClient.on('connected', onConnect);
      tempClient.on('error', onError);
      tempClient.connect();
    });

    const result = await tempClient.publish(channel, data);

    tempClient.disconnect();

    return result;
  }

  private extractSubId(channel: string): string | null {
    const idx = channel.lastIndexOf('#');

    if (idx === -1) {
      return null;
    }

    return channel.slice(idx + 1);
  }

  async publish(channel: string, data: unknown): Promise<PublishResult> {
    await this.waitForConnected();

    return this.client.publish(channel, data);
  }

  async publishSub(channel: string, data: unknown): Promise<PublishResult> {
    const subId = this.extractSubId(channel);

    if (!subId) {
      throw new Error('Invalid channel format');
    }

    const token = this.generateSubToken(subId);

    return this.publishWithToken(token, channel, data);
  }

  async onMessage(
    channel: string,
    handler: (data: unknown, ctx: PublicationContext) => void
  ): Promise<Subscription> {
    await this.waitForConnected();

    const subscription =
      this.client.getSubscription(channel) ??
      this.client.newSubscription(channel);

    subscription.on('publication', (ctx) => {
      handler(ctx.data, ctx);
    });

    if (subscription.state !== SubscriptionState.Subscribed) {
      subscription.subscribe();
    }

    return subscription;
  }

  async onMessageSub(
    channel: string,
    handler: (data: unknown, ctx: PublicationContext) => void
  ): Promise<void> {
    const subId = this.extractSubId(channel);

    if (!subId) {
      throw new Error('Invalid channel format');
    }

    const token = this.generateSubToken(subId);

    const tempClient = new Centrifuge(
      `${centrifugoEnvironment.centrifugoWsUrl}/connection/websocket`,
      {
        websocket: WebSocket,
        token,
        timeout: 30_000,
        maxServerPingDelay: 60_000,
      }
    );

    tempClient.on('publication', (ctx) => {
      handler(ctx.data, ctx);
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        tempClient.off('connected', onConnect);
        resolve();
      };

      const onError = (err: unknown) => {
        tempClient.off('error', onError);
        reject(err);
      };

      tempClient.on('connected', onConnect);
      tempClient.on('error', onError);
      tempClient.connect();
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.waitForConnected();

    const subscription = this.client.getSubscription(channel);

    if (subscription && subscription.state !== SubscriptionState.Unsubscribed) {
      subscription.unsubscribe();
    }
  }
}
