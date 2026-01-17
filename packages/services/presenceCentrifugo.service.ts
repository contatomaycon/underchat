import { injectable, inject } from 'tsyringe';
import { Centrifuge, PublishResult } from 'centrifuge';
import { centrifugoEnvironment } from '@core/config/environments';
import { logger } from '@core/plugins/telemetry/logger';
import { captureException } from '@core/plugins/telemetry/sentry';
import {
  IQueuedPublish,
  ICachedPublish,
} from '@core/common/interfaces/ICentrifugo';

@injectable()
export class PresenceCentrifugoService {
  private readonly publishRetryAttempts = 3;
  private readonly publishRetryBaseDelayMs = 500;
  private readonly publishRetryMaxDelayMs = 4_000;
  private readonly httpApiTimeoutMs = 20_000;
  private readonly circuitBreakerThreshold = 10;
  private readonly circuitBreakerResetMs = 30_000;
  private readonly rateLimitPerSecond = 100;
  private readonly debounceWindowMs = 100;
  private readonly queueProcessIntervalMs = 50;
  private readonly publishCacheWindowMs = 5_000;
  private readonly publishCacheCleanupIntervalMs = 10_000;

  private circuitBreakerFailures = 0;
  private circuitBreakerOpenUntil = 0;
  private tokenBucket = this.rateLimitPerSecond;
  private lastTokenRefill = Date.now();
  private publishQueue: IQueuedPublish[] = [];
  private debounceMap = new Map<string, NodeJS.Timeout>();
  private publishCache = new Map<string, ICachedPublish>();
  private queueProcessTimer: ReturnType<typeof setInterval> | null = null;
  private cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessingQueue = false;

  constructor(@inject('Centrifuge') private readonly client: Centrifuge) {
    this.startQueueProcessor();
    this.startCacheCleanup();
  }

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

  private isCircuitOpen(): boolean {
    const now = Date.now();

    if (this.circuitBreakerOpenUntil && now < this.circuitBreakerOpenUntil) {
      return true;
    }

    if (this.circuitBreakerOpenUntil && now >= this.circuitBreakerOpenUntil) {
      this.circuitBreakerFailures = 0;
      this.circuitBreakerOpenUntil = 0;
    }

    return false;
  }

  private recordCircuitFailure(): void {
    this.circuitBreakerFailures++;

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerOpenUntil = Date.now() + this.circuitBreakerResetMs;

      logger.error(
        {
          type: 'presence_centrifugo_circuit_breaker_open',
          failures: this.circuitBreakerFailures,
          resetMs: this.circuitBreakerResetMs,
        },
        'Presence Centrifugo circuit breaker opened'
      );

      captureException(
        new Error('Presence Centrifugo circuit breaker opened'),
        {
          level: 'error',
          centrifugo: {
            type: 'presence_circuit_breaker_open',
            failures: this.circuitBreakerFailures,
          },
        }
      );
    }
  }

  private recordCircuitSuccess(): void {
    if (this.circuitBreakerFailures > 0) {
      this.circuitBreakerFailures = Math.max(
        0,
        this.circuitBreakerFailures - 1
      );
    }
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastTokenRefill;
    const tokensToAdd = Math.floor(
      (timePassed / 1000) * this.rateLimitPerSecond
    );

    if (tokensToAdd > 0) {
      this.tokenBucket = Math.min(
        this.rateLimitPerSecond,
        this.tokenBucket + tokensToAdd
      );
      this.lastTokenRefill = now;
    }
  }

  private hasAvailableToken(): boolean {
    this.refillTokens();
    return this.tokenBucket > 0;
  }

  private consumeToken(): boolean {
    this.refillTokens();

    if (this.tokenBucket > 0) {
      this.tokenBucket--;
      return true;
    }

    return false;
  }

  private getDebounceKey(channel: string, data: unknown): string {
    try {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      return `${channel}:${dataStr}`;
    } catch {
      return `${channel}:${Date.now()}`;
    }
  }

  private generateHash(channel: string, data: unknown): string {
    try {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      let hash = 0;

      for (let i = 0; i < dataStr.length; i++) {
        const char = dataStr.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }

      return `${channel}:${hash.toString(36)}`;
    } catch {
      return `${channel}:${Date.now()}`;
    }
  }

  private isDuplicatePublish(channel: string, data: unknown): boolean {
    const hash = this.generateHash(channel, data);
    const cached = this.publishCache.get(hash);

    if (!cached) {
      return false;
    }

    const age = Date.now() - cached.timestamp;

    if (age > this.publishCacheWindowMs) {
      this.publishCache.delete(hash);
      return false;
    }

    return true;
  }

  private cachePublish(channel: string, data: unknown): void {
    const hash = this.generateHash(channel, data);

    this.publishCache.set(hash, {
      channel,
      data,
      timestamp: Date.now(),
      hash,
    });
  }

  private cleanupPublishCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [hash, cached] of this.publishCache.entries()) {
      const age = now - cached.timestamp;

      if (age > this.publishCacheWindowMs) {
        toDelete.push(hash);
      }
    }

    for (const hash of toDelete) {
      this.publishCache.delete(hash);
    }

    if (toDelete.length > 0) {
      logger.debug(
        {
          type: 'presence_centrifugo_cache_cleanup',
          removed: toDelete.length,
          remaining: this.publishCache.size,
        },
        'Cleaned up Presence Centrifugo publish cache'
      );
    }
  }

  private startCacheCleanup(): void {
    if (this.cacheCleanupTimer) {
      return;
    }

    this.cacheCleanupTimer = setInterval(() => {
      this.cleanupPublishCache();
    }, this.publishCacheCleanupIntervalMs);
  }

  private stopCacheCleanup(): void {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = null;
    }
  }

  private startQueueProcessor(): void {
    if (this.queueProcessTimer) {
      return;
    }

    this.queueProcessTimer = setInterval(() => {
      this.processQueue().catch((error) => {
        logger.error(
          {
            err: error,
            type: 'presence_centrifugo_queue_processor_error',
          },
          'Error processing Presence Centrifugo queue'
        );
      });
    }, this.queueProcessIntervalMs);
  }

  private stopQueueProcessor(): void {
    if (this.queueProcessTimer) {
      clearInterval(this.queueProcessTimer);
      this.queueProcessTimer = null;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.publishQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.publishQueue.length > 0 && this.hasAvailableToken()) {
        const item = this.publishQueue.shift();

        if (!item) {
          break;
        }

        if (!this.consumeToken()) {
          this.publishQueue.unshift(item);
          break;
        }

        const ageMs = Date.now() - item.timestamp;

        if (ageMs > 30_000) {
          item.reject(new Error('Publish timeout: too long in queue'));
          continue;
        }

        try {
          const result = await this.publishViaHttpApiDirect(
            item.channel,
            item.data
          );
          item.resolve(result);
        } catch (error) {
          item.reject(this.toError(error));
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private enqueuePublish(
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    return new Promise<PublishResult>((resolve, reject) => {
      this.publishQueue.push({
        channel,
        data,
        timestamp: Date.now(),
        resolve,
        reject,
      });

      if (this.publishQueue.length > 500) {
        logger.warn(
          {
            type: 'presence_centrifugo_queue_overflow',
            queueSize: this.publishQueue.length,
          },
          'Presence Centrifugo publish queue is growing large'
        );
      }
    });
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

    if (message.includes('circuit breaker is open')) {
      return false;
    }

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

  private isTimeoutError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection timeout')
    );
  }

  private async withPublishRetry(
    action: () => Promise<PublishResult>,
    context: { channel: string; subId?: string }
  ): Promise<PublishResult> {
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= this.publishRetryAttempts; attempt++) {
      try {
        const result = await action();

        if (attempt > 1) {
          logger.info(
            {
              type: 'presence_centrifugo_publish_retry_success',
              channel: context.channel,
              subId: context.subId,
              attempt,
              durationMs: Date.now() - startTime,
            },
            'Presence Centrifugo publish succeeded after retry'
          );
        }

        return result;
      } catch (error) {
        const normalizedError = this.toError(error);
        lastError = normalizedError;
        const isTransient = this.isTransientError(normalizedError);
        const isLastAttempt = attempt === this.publishRetryAttempts;
        const isTimeout = this.isTimeoutError(normalizedError);

        if (attempt > 1) {
          logger.warn(
            {
              type: 'presence_centrifugo_publish_retry_attempt',
              channel: context.channel,
              subId: context.subId,
              attempt,
              error: normalizedError.message,
            },
            `Presence Centrifugo publish retry attempt ${attempt} failed`
          );
        }

        if (!isTransient && !isTimeout) {
          throw normalizedError;
        }

        if (isLastAttempt) {
          const logLevel = isTimeout ? 'warn' : 'error';
          const logMessage = isTimeout
            ? 'Presence Centrifugo publish timeout after retries - non-critical'
            : 'Presence Centrifugo publish failed after retries';

          logger[logLevel](
            {
              err: normalizedError,
              type: 'presence_centrifugo_publish_error',
              channel: context.channel,
              subId: context.subId,
              attempts: this.publishRetryAttempts,
              durationMs: Date.now() - startTime,
            },
            logMessage
          );

          captureException(normalizedError, {
            level: isTimeout ? 'warning' : 'error',
            centrifugo: {
              type: 'presence_publish_error',
              channel: context.channel,
              subId: context.subId,
              attempts: this.publishRetryAttempts,
              durationMs: Date.now() - startTime,
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
      const isTimeout = this.isTimeoutError(lastError);
      const logLevel = isTimeout ? 'warn' : 'error';
      const logMessage = isTimeout
        ? 'Presence Centrifugo publish timeout without recovery - non-critical'
        : 'Presence Centrifugo publish failed without recovery';

      logger[logLevel](
        {
          err: lastError,
          type: 'presence_centrifugo_publish_error',
          channel: context.channel,
          subId: context.subId,
          attempts: this.publishRetryAttempts,
          durationMs: Date.now() - startTime,
        },
        logMessage
      );

      captureException(lastError, {
        level: isTimeout ? 'warning' : 'error',
        centrifugo: {
          type: 'presence_publish_error',
          channel: context.channel,
          subId: context.subId,
          attempts: this.publishRetryAttempts,
          durationMs: Date.now() - startTime,
        },
      });
    }

    return {} as PublishResult;
  }

  private async publishViaHttpApiDirect(
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    if (this.isCircuitOpen()) {
      throw new Error('Presence Centrifugo circuit breaker is open');
    }

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
        this.recordCircuitFailure();
        throw error;
      }

      const payload = (await response.json().catch(() => null)) as {
        result?: PublishResult;
        error?: { message?: string };
      } | null;

      if (payload?.error) {
        this.recordCircuitFailure();
        throw new Error(
          `Centrifugo HTTP API error: ${payload.error.message ?? 'unknown'}`
        );
      }

      this.recordCircuitSuccess();
      return (payload?.result ?? {}) as PublishResult;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.recordCircuitFailure();
        throw new Error('Centrifugo HTTP API timeout');
      }

      if (error instanceof Error && (error as { status?: number }).status) {
        throw error;
      }

      if (error instanceof Error) {
        this.recordCircuitFailure();
        const wrapped = new Error('Centrifugo HTTP API connection error');
        (wrapped as { cause?: unknown }).cause = error;
        throw wrapped;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async publishViaHttpApi(
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    const debounceKey = this.getDebounceKey(channel, data);
    const existingDebounce = this.debounceMap.get(debounceKey);

    if (existingDebounce) {
      clearTimeout(existingDebounce);
    }

    return new Promise<PublishResult>((resolve, reject) => {
      const debounceTimer = setTimeout(() => {
        this.debounceMap.delete(debounceKey);

        if (this.consumeToken()) {
          this.publishViaHttpApiDirect(channel, data)
            .then(resolve)
            .catch(reject);
        } else {
          this.enqueuePublish(channel, data).then(resolve).catch(reject);
        }
      }, this.debounceWindowMs);

      this.debounceMap.set(debounceKey, debounceTimer);
    });
  }

  private extractSubId(channel: string): string | null {
    const idx = channel.lastIndexOf('#');

    if (idx === -1) {
      return null;
    }

    return channel.slice(idx + 1);
  }

  private handlePublishError(
    error: unknown,
    channel: string,
    type: string
  ): PublishResult {
    const errorObj = this.toError(error);
    const isTimeout = this.isTimeoutError(errorObj);

    logger.warn(
      {
        err: errorObj,
        type,
        channel,
      },
      isTimeout
        ? `Presence Centrifugo ${type} timeout - non-critical`
        : `Presence Centrifugo ${type} error - non-critical`
    );

    captureException(errorObj, {
      level: 'warning',
      centrifugo: {
        type,
        channel,
      },
    });

    return {} as PublishResult;
  }

  async publishSub(channel: string, data: unknown): Promise<PublishResult> {
    try {
      const subId = this.extractSubId(channel);

      if (!subId) {
        logger.warn(
          {
            type: 'presence_centrifugo_invalid_channel',
            channel,
          },
          'Invalid channel format for publishSub'
        );
        return {} as PublishResult;
      }

      if (this.isDuplicatePublish(channel, data)) {
        logger.debug(
          {
            type: 'presence_centrifugo_publish_sub_deduplicated',
            channel,
            subId,
          },
          'Skipped duplicate publishSub within cache window'
        );

        return {} as PublishResult;
      }

      this.cachePublish(channel, data);

      return await this.withPublishRetry(
        () => this.publishViaHttpApi(channel, data),
        {
          channel,
          subId,
        }
      );
    } catch (error) {
      return this.handlePublishError(
        error,
        channel,
        'presence_centrifugo_publish_sub_error'
      );
    }
  }

  getQueueStats(): {
    queueSize: number;
    availableTokens: number;
    isProcessing: boolean;
    debouncePending: number;
    cacheSize: number;
    circuitBreakerFailures: number;
    circuitBreakerOpen: boolean;
  } {
    this.refillTokens();

    return {
      queueSize: this.publishQueue.length,
      availableTokens: this.tokenBucket,
      isProcessing: this.isProcessingQueue,
      debouncePending: this.debounceMap.size,
      cacheSize: this.publishCache.size,
      circuitBreakerFailures: this.circuitBreakerFailures,
      circuitBreakerOpen: this.isCircuitOpen(),
    };
  }

  cleanup(): void {
    this.stopQueueProcessor();
    this.stopCacheCleanup();

    for (const timer of this.debounceMap.values()) {
      clearTimeout(timer);
    }

    this.debounceMap.clear();
    this.publishCache.clear();

    for (const item of this.publishQueue) {
      item.reject(new Error('Service cleanup'));
    }

    this.publishQueue = [];
  }
}
