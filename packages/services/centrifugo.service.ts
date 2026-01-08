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
  private readonly publishRetryAttempts = 3;
  private readonly publishRetryBaseDelayMs = 500;
  private readonly publishRetryMaxDelayMs = 4_000;
  private readonly connectTimeoutMs = 15_000;

  constructor(@inject('Centrifuge') private readonly client: Centrifuge) {}

  private toError(e: unknown): Error {
    if (e instanceof Error) return e;
    if (typeof e === 'string') return new Error(e);
    try {
      return new Error(JSON.stringify(e));
    } catch {
      return new Error(String(e));
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase();
    const cause = (error as { cause?: unknown }).cause;

    if (
      message.includes('timeout') ||
      message.includes('transport closed') ||
      message.includes('websocket') ||
      message.includes('connection') ||
      message.includes('connect') ||
      message.includes('network')
    ) {
      return true;
    }

    if (cause instanceof Error) {
      const causeMessage = cause.message.toLowerCase();

      return (
        causeMessage.includes('timeout') ||
        causeMessage.includes('connection') ||
        causeMessage.includes('connect')
      );
    }

    return false;
  }

  private async waitForConnected(): Promise<void> {
    if (this.client.state === State.Connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      let onConnected: () => void;
      let onError: (err: unknown) => void;
      let onDisconnected: () => void;

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        try {
          this.client.off('connected', onConnected);
          this.client.off('error', onError);
          this.client.off('disconnected', onDisconnected);
        } catch {}
      };

      onConnected = (): void => {
        cleanup();
        resolve();
      };

      onError = (err: unknown): void => {
        cleanup();
        reject(this.toError(err));
      };

      onDisconnected = (): void => {
        if (this.client.state !== State.Connected) {
          cleanup();
          reject(new Error('Centrifugo disconnected before connect'));
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Centrifugo connection timeout'));
      }, this.connectTimeoutMs);

      this.client.on('connected', onConnected);
      this.client.on('error', onError);
      this.client.on('disconnected', onDisconnected);

      if (this.client.state === State.Disconnected) {
        try {
          this.client.connect();
        } catch (err) {
          cleanup();
          reject(this.toError(err));
        }
      }
    });
  }

  private generateSubToken(subId: string): string {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    return jwt.sign(
      { sub: subId, exp },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  }

  private async withPublishRetry(
    action: () => Promise<PublishResult>,
    context: { channel: string; subId?: string }
  ): Promise<PublishResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.publishRetryAttempts; attempt++) {
      try {
        return await action();
      } catch (error) {
        const normalizedError = this.toError(error);
        lastError = normalizedError;
        const isTransient = this.isTransientError(normalizedError);
        const isLastAttempt = attempt === this.publishRetryAttempts;

        if (!isTransient) {
          throw normalizedError;
        }

        if (isLastAttempt) {
          console.error('Centrifugo publish failed after retries', {
            channel: context.channel,
            subId: context.subId,
            error: normalizedError.message,
          });

          return {} as PublishResult;
        }

        const backoff = Math.min(
          this.publishRetryBaseDelayMs * 2 ** (attempt - 1),
          this.publishRetryMaxDelayMs
        );

        await this.delay(backoff);
      }
    }

    if (lastError) {
      console.error('Centrifugo publish failed without recovery', {
        channel: context.channel,
        subId: context.subId,
        error: lastError.message,
      });
    }

    return {} as PublishResult;
  }

  private async connectTempClient(client: Centrifuge): Promise<void> {
    if (client.state === State.Connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      let onConnect: () => void;
      let onError: (err: unknown) => void;
      let onDisconnected: () => void;

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        try {
          client.off('connected', onConnect);
          client.off('error', onError);
          client.off('disconnected', onDisconnected);
        } catch {}
      };

      onConnect = (): void => {
        cleanup();
        resolve();
      };

      onError = (err: unknown): void => {
        cleanup();
        reject(this.toError(err));
      };

      onDisconnected = (): void => {
        if (client.state !== State.Connected) {
          cleanup();
          reject(
            new Error('Centrifugo temp client disconnected before connect')
          );
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Centrifugo temp client connection timeout'));
      }, this.connectTimeoutMs);

      client.on('connected', onConnect);
      client.on('error', onError);
      client.on('disconnected', onDisconnected);
      client.connect();
    });
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

    const cleanup = (): void => {
      try {
        tempClient.removeAllListeners();
      } catch {}

      try {
        if (tempClient.state !== State.Disconnected) {
          tempClient.disconnect();
        }
      } catch {}
    };

    try {
      await this.connectTempClient(tempClient);

      if (tempClient.state !== State.Connected) {
        throw new Error('Connection closed before publish');
      }

      return await tempClient.publish(channel, data);
    } catch (error) {
      const errorObj = this.toError(error);

      if (
        errorObj.message.includes('transport closed') ||
        errorObj.message.includes('Transport closed')
      ) {
        throw new Error('Connection closed during publish');
      }

      throw errorObj;
    } finally {
      cleanup();
    }
  }

  private extractSubId(channel: string): string | null {
    const idx = channel.lastIndexOf('#');

    if (idx === -1) {
      return null;
    }

    return channel.slice(idx + 1);
  }

  async publish(channel: string, data: unknown): Promise<PublishResult> {
    return this.withPublishRetry(
      async () => {
        await this.waitForConnected();
        return this.client.publish(channel, data);
      },
      { channel }
    );
  }

  async publishSub(channel: string, data: unknown): Promise<PublishResult> {
    const subId = this.extractSubId(channel);

    if (!subId) {
      throw new Error('Invalid channel format');
    }

    const token = this.generateSubToken(subId);

    return this.withPublishRetry(
      () => this.publishWithToken(token, channel, data),
      { channel, subId }
    );
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
        reject(this.toError(err));
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
