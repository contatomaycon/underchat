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
import { logger } from '@core/plugins/telemetry/logger';
import { captureException } from '@core/plugins/telemetry/sentry';

@injectable()
export class CentrifugoService {
  private readonly publishRetryAttempts = 3;
  private readonly publishRetryBaseDelayMs = 500;
  private readonly publishRetryMaxDelayMs = 4_000;
  private readonly connectTimeoutMs = 15_000;
  private readonly httpApiTimeoutMs = 10_000;
  private readonly maxConcurrentTempClients = 5;
  private readonly publishQueueMaxSize = 1000;

  private activeTempClients = 0;
  private publishQueue: Array<{
    execute: () => Promise<PublishResult>;
    resolve: (result: PublishResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private processingQueue = false;

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

  private async processPublishQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    while (this.publishQueue.length > 0) {
      if (this.activeTempClients >= this.maxConcurrentTempClients) {
        await this.delay(100);
        continue;
      }

      const item = this.publishQueue.shift();

      if (!item) {
        break;
      }

      this.activeTempClients++;

      item
        .execute()
        .then((result) => {
          item.resolve(result);
        })
        .catch((error) => {
          item.reject(this.toError(error));
        })
        .finally(() => {
          this.activeTempClients--;
        });
    }

    this.processingQueue = false;
  }

  private async queuePublishWithToken(
    token: string,
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    if (this.publishQueue.length >= this.publishQueueMaxSize) {
      logger.warn(
        {
          type: 'centrifugo_queue_full',
          channel,
          queueSize: this.publishQueue.length,
        },
        'Centrifugo publish queue is full, rejecting publish'
      );

      throw new Error('Centrifugo publish queue is full');
    }

    return new Promise<PublishResult>((resolve, reject) => {
      this.publishQueue.push({
        execute: () => this.publishWithToken(token, channel, data),
        resolve,
        reject,
      });

      this.processPublishQueue();
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTransientError(error: Error): boolean {
    const status = (error as { status?: number }).status;

    if (status) {
      if (status >= 500 || status === 408 || status === 429) {
        return true;
      }

      if (status >= 400) {
        return false;
      }
    }

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
      let isResolved = false;

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

      const safeReject = (error: Error): void => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        cleanup();
        reject(error);
      };

      const safeResolve = (): void => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        cleanup();
        resolve();
      };

      onConnected = (): void => {
        safeResolve();
      };

      onError = (err: unknown): void => {
        safeReject(this.toError(err));
      };

      onDisconnected = (): void => {
        if (this.client.state !== State.Connected) {
          safeReject(new Error('Centrifugo disconnected before connect'));
        }
      };

      timer = setTimeout(() => {
        safeReject(new Error('Centrifugo connection timeout'));
      }, this.connectTimeoutMs);

      try {
        this.client.on('connected', onConnected);
        this.client.on('error', onError);
        this.client.on('disconnected', onDisconnected);

        if (this.client.state === State.Disconnected) {
          this.client.connect();
        }
      } catch (err) {
        safeReject(this.toError(err));
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
        const errorMessage = normalizedError.message.toLowerCase();
        const isTimeoutError =
          errorMessage.includes('timeout') ||
          errorMessage.includes('connection timeout');

        if (!isTransient && !isTimeoutError) {
          throw normalizedError;
        }

        if (isLastAttempt) {
          const logLevel = isTimeoutError ? 'warn' : 'error';
          const logMessage = isTimeoutError
            ? 'Centrifugo publish timeout after retries - non-critical'
            : 'Centrifugo publish failed after retries';

          logger[logLevel](
            {
              err: normalizedError,
              type: 'centrifugo_publish_error',
              channel: context.channel,
              subId: context.subId,
              attempts: this.publishRetryAttempts,
            },
            logMessage
          );

          captureException(normalizedError, {
            level: isTimeoutError ? 'warning' : 'error',
            centrifugo: {
              type: 'publish_error',
              channel: context.channel,
              subId: context.subId,
              attempts: this.publishRetryAttempts,
            },
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
      const errorMessage = lastError.message.toLowerCase();
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection timeout');
      const logLevel = isTimeoutError ? 'warn' : 'error';
      const logMessage = isTimeoutError
        ? 'Centrifugo publish timeout without recovery - non-critical'
        : 'Centrifugo publish failed without recovery';

      logger[logLevel](
        {
          err: lastError,
          type: 'centrifugo_publish_error',
          channel: context.channel,
          subId: context.subId,
          attempts: this.publishRetryAttempts,
        },
        logMessage
      );

      captureException(lastError, {
        level: isTimeoutError ? 'warning' : 'error',
        centrifugo: {
          type: 'publish_error',
          channel: context.channel,
          subId: context.subId,
          attempts: this.publishRetryAttempts,
        },
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
      let isResolved = false;

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

      const safeReject = (error: Error): void => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        cleanup();

        try {
          if (client.state !== State.Disconnected) {
            client.disconnect();
          }
        } catch {}

        const errorMessage = error.message.toLowerCase();
        const isTimeoutError =
          errorMessage.includes('timeout') ||
          errorMessage.includes('connection timeout');

        if (isTimeoutError) {
          logger.warn(
            {
              err: error,
              type: 'centrifugo_temp_client_timeout',
            },
            'Centrifugo temp client connection timeout - non-critical'
          );

          captureException(error, {
            level: 'warning',
            centrifugo: {
              type: 'temp_client_timeout',
            },
          });
        }

        reject(error);
      };

      const safeResolve = (): void => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        cleanup();
        resolve();
      };

      onConnect = (): void => {
        safeResolve();
      };

      onError = (err: unknown): void => {
        const error = this.toError(err);
        const errorMessage = error.message.toLowerCase();
        const isTimeoutError =
          errorMessage.includes('timeout') ||
          errorMessage.includes('connection timeout');

        if (isTimeoutError) {
          logger.warn(
            {
              err: error,
              type: 'centrifugo_temp_client_error',
            },
            'Centrifugo temp client error - non-critical'
          );
        }

        safeReject(error);
      };

      onDisconnected = (): void => {
        if (client.state !== State.Connected) {
          safeReject(
            new Error('Centrifugo temp client disconnected before connect')
          );
        }
      };

      timer = setTimeout(() => {
        safeReject(new Error('Centrifugo temp client connection timeout'));
      }, this.connectTimeoutMs);

      try {
        client.on('connected', onConnect);
        client.on('error', onError);
        client.on('disconnected', onDisconnected);
        client.connect();
      } catch (err) {
        safeReject(this.toError(err));
      }
    });
  }

  private async publishViaHttpApi(
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    const url = centrifugoEnvironment.centrifugoHttpApiUrl;
    const apiKey = centrifugoEnvironment.centrifugoHttpApiKey;

    if (!url || !apiKey) {
      throw new Error('Centrifugo HTTP API is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.httpApiTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `apikey ${apiKey}`,
        },
        body: JSON.stringify({
          method: 'publish',
          params: {
            channel,
            data,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const error = new Error(
          `Centrifugo HTTP API error: ${response.status} ${response.statusText}${
            bodyText ? ` - ${bodyText}` : ''
          }`
        );
        (error as { status?: number }).status = response.status;
        throw error;
      }

      const payload = (await response.json().catch(() => null)) as {
        result?: PublishResult;
        error?: { message?: string };
      } | null;

      if (payload?.error) {
        throw new Error(
          `Centrifugo HTTP API error: ${payload.error.message ?? 'unknown'}`
        );
      }

      return (payload?.result ?? {}) as PublishResult;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Centrifugo HTTP API timeout');
      }

      if (error instanceof Error && (error as { status?: number }).status) {
        throw error;
      }

      if (error instanceof Error) {
        const wrapped = new Error('Centrifugo HTTP API connection error');
        (wrapped as { cause?: unknown }).cause = error;
        throw wrapped;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
      const errorMessage = errorObj.message.toLowerCase();
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection timeout');

      if (isTimeoutError) {
        logger.warn(
          {
            err: errorObj,
            type: 'centrifugo_publish_timeout',
            channel,
          },
          'Centrifugo publish timeout - non-critical'
        );

        throw errorObj;
      }

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
    try {
      return await this.withPublishRetry(
        async () => {
          await this.waitForConnected();
          return this.client.publish(channel, data);
        },
        { channel }
      );
    } catch (error) {
      const errorObj = this.toError(error);
      const errorMessage = errorObj.message.toLowerCase();
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection timeout');

      logger.warn(
        {
          err: errorObj,
          type: 'centrifugo_publish_error',
          channel,
        },
        isTimeoutError
          ? 'Centrifugo publish timeout - non-critical'
          : 'Centrifugo publish error - non-critical'
      );

      captureException(errorObj, {
        level: 'warning',
        centrifugo: {
          type: 'publish_error',
          channel,
        },
      });

      return {} as PublishResult;
    }
  }

  async publishSub(channel: string, data: unknown): Promise<PublishResult> {
    try {
      const subId = this.extractSubId(channel);

      if (!subId) {
        logger.warn(
          {
            type: 'centrifugo_invalid_channel',
            channel,
          },
          'Invalid channel format for publishSub'
        );
        return {} as PublishResult;
      }

      return await this.withPublishRetry(
        () => this.publishViaHttpApi(channel, data),
        {
          channel,
          subId,
        }
      );
    } catch (error) {
      const errorObj = this.toError(error);
      const errorMessage = errorObj.message.toLowerCase();
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection timeout');

      logger.warn(
        {
          err: errorObj,
          type: 'centrifugo_publish_sub_error',
          channel,
        },
        isTimeoutError
          ? 'Centrifugo publishSub timeout - non-critical'
          : 'Centrifugo publishSub error - non-critical'
      );

      captureException(errorObj, {
        level: 'warning',
        centrifugo: {
          type: 'publish_sub_error',
          channel,
        },
      });

      return {} as PublishResult;
    }
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
    try {
      const subId = this.extractSubId(channel);

      if (!subId) {
        logger.warn(
          {
            type: 'centrifugo_invalid_channel',
            channel,
          },
          'Invalid channel format for onMessageSub'
        );
        return;
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
        let timer: ReturnType<typeof setTimeout> | null = null;
        let isResolved = false;

        let onConnect: () => void;
        let onError: (err: unknown) => void;

        const cleanup = (): void => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          try {
            tempClient.off('connected', onConnect);
            tempClient.off('error', onError);
          } catch {}
        };

        const safeReject = (error: Error): void => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          cleanup();

          try {
            if (tempClient.state !== State.Disconnected) {
              tempClient.disconnect();
            }
          } catch {}

          const errorMessage = error.message.toLowerCase();
          const isTimeoutError =
            errorMessage.includes('timeout') ||
            errorMessage.includes('connection timeout');

          if (isTimeoutError) {
            logger.warn(
              {
                err: error,
                type: 'centrifugo_on_message_sub_timeout',
                channel,
              },
              'Centrifugo onMessageSub connection timeout - non-critical'
            );

            captureException(error, {
              level: 'warning',
              centrifugo: {
                type: 'on_message_sub_timeout',
                channel,
              },
            });
          }

          reject(error);
        };

        const safeResolve = (): void => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          cleanup();
          resolve();
        };

        onConnect = (): void => {
          safeResolve();
        };

        onError = (err: unknown): void => {
          const error = this.toError(err);
          const errorMessage = error.message.toLowerCase();
          const isTimeoutError =
            errorMessage.includes('timeout') ||
            errorMessage.includes('connection timeout');

          if (isTimeoutError) {
            logger.warn(
              {
                err: error,
                type: 'centrifugo_on_message_sub_error',
                channel,
              },
              'Centrifugo onMessageSub error - non-critical'
            );
          }

          safeReject(error);
        };

        timer = setTimeout(() => {
          safeReject(new Error('Centrifugo temp client connection timeout'));
        }, this.connectTimeoutMs);

        try {
          tempClient.on('connected', onConnect);
          tempClient.on('error', onError);
          tempClient.connect();
        } catch (err) {
          safeReject(this.toError(err));
        }
      });
    } catch (error) {
      const errorObj = this.toError(error);
      const errorMessage = errorObj.message.toLowerCase();
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection timeout');

      logger.warn(
        {
          err: errorObj,
          type: 'centrifugo_on_message_sub_error',
          channel,
        },
        isTimeoutError
          ? 'Centrifugo onMessageSub timeout - non-critical'
          : 'Centrifugo onMessageSub error - non-critical'
      );

      captureException(errorObj, {
        level: 'warning',
        centrifugo: {
          type: 'on_message_sub_error',
          channel,
        },
      });
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.waitForConnected();

    const subscription = this.client.getSubscription(channel);

    if (subscription && subscription.state !== SubscriptionState.Unsubscribed) {
      subscription.unsubscribe();
    }
  }
}
