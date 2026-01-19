import { injectable, inject, container } from 'tsyringe';
import { Centrifuge, PublishResult } from 'centrifuge';
import { createHash } from 'crypto';
import Redis from 'ioredis';
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
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private halfOpenSuccessCount = 0;
  private readonly circuitBreakerHalfOpenAttempts = 3;
  private readonly maxBurstSize = 10;
  private readonly publishCacheMaxSize = 5_000;
  private tokenBucket = 10;
  private lastTokenRefill = Date.now();
  private publishQueue: IQueuedPublish[] = [];
  private debounceMap = new Map<string, NodeJS.Timeout>();
  private publishCache = new Map<string, ICachedPublish>();
  private queueProcessTimer: ReturnType<typeof setInterval> | null = null;
  private cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessingQueue = false;
  private queueProcessingLock = Promise.resolve();
  private readonly useDistributed: boolean;
  private readonly redis: Redis | undefined;

  constructor(@inject('Centrifuge') private readonly client: Centrifuge) {
    try {
      this.redis = container.resolve<Redis>('Redis');
    } catch {
      this.redis = undefined;
    }

    this.useDistributed =
      process.env.USE_DISTRIBUTED_CENTRIFUGO === 'true' && !!this.redis;
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

  private async isCircuitOpen(): Promise<boolean> {
    if (this.useDistributed && this.redis) {
      const key = 'presence_centrifugo:circuit_breaker:open_until';
      const openUntilStr = await this.redis.get(key).catch(() => null);

      if (!openUntilStr) {
        return false;
      }

      const openUntil = Number.parseInt(openUntilStr, 10);
      const now = Date.now();

      if (now < openUntil) {
        return true;
      }

      await this.redis.del(key).catch(() => {});
      await this.redis
        .del('presence_centrifugo:circuit_breaker:failures')
        .catch(() => {});
      return false;
    }

    const now = Date.now();

    if (this.circuitBreakerState === 'open') {
      if (now >= this.circuitBreakerOpenUntil) {
        this.circuitBreakerState = 'half-open';
        this.halfOpenSuccessCount = 0;
        logger.info(
          { type: 'presence_centrifugo_circuit_breaker_half_open' },
          'Presence Centrifugo circuit breaker moved to half-open state'
        );
        return false;
      }
      return true;
    }

    if (this.circuitBreakerState === 'half-open') {
      return false;
    }

    return false;
  }

  private async recordCircuitFailure(): Promise<void> {
    if (this.useDistributed && this.redis) {
      const failuresKey = 'presence_centrifugo:circuit_breaker:failures';
      const openUntilKey = 'presence_centrifugo:circuit_breaker:open_until';

      try {
        const failures = await this.redis.incr(failuresKey);
        await this.redis.expire(
          failuresKey,
          Math.ceil(this.circuitBreakerResetMs / 1000) + 60
        );

        if (failures >= this.circuitBreakerThreshold) {
          const openUntil = Date.now() + this.circuitBreakerResetMs;
          await this.redis.set(
            openUntilKey,
            openUntil.toString(),
            'EX',
            Math.ceil(this.circuitBreakerResetMs / 1000) + 60
          );

          logger.error(
            {
              type: 'presence_centrifugo_circuit_breaker_open',
              failures,
              resetMs: this.circuitBreakerResetMs,
            },
            'Presence Centrifugo circuit breaker opened'
          );

          captureException(
            new Error('Presence Centrifugo circuit breaker opened'),
            {
              level: 'error',
              centrifugo: { type: 'presence_circuit_breaker_open', failures },
            }
          );
        }
      } catch (error) {
        logger.warn(
          { err: error },
          'Error in distributed circuit breaker, falling back to local'
        );
        this.recordCircuitFailureLocal();
      }
      return;
    }

    this.recordCircuitFailureLocal();
  }

  private recordCircuitFailureLocal(): void {
    this.circuitBreakerFailures++;

    if (this.circuitBreakerState === 'half-open') {
      this.circuitBreakerState = 'open';
      this.circuitBreakerOpenUntil = Date.now() + this.circuitBreakerResetMs;
      this.halfOpenSuccessCount = 0;

      logger.error(
        {
          type: 'presence_centrifugo_circuit_breaker_half_open_failed',
        },
        'Presence Centrifugo circuit breaker half-open test failed, reopening'
      );
      return;
    }

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerState = 'open';
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

  private async recordCircuitSuccess(): Promise<void> {
    if (this.useDistributed && this.redis) {
      const failuresKey = 'presence_centrifugo:circuit_breaker:failures';
      try {
        const current = await this.redis.get(failuresKey);
        if (current && Number.parseInt(current, 10) > 0) {
          const failures = Number.parseInt(current, 10);
          if (failures > 0) {
            await this.redis.set(failuresKey, (failures - 1).toString());
          }
        }
      } catch (error) {
        logger.warn(
          { err: error },
          'Error in distributed circuit breaker success, falling back to local'
        );
        this.recordCircuitSuccessLocal();
      }
      return;
    }

    this.recordCircuitSuccessLocal();
  }

  private recordCircuitSuccessLocal(): void {
    if (this.circuitBreakerState === 'half-open') {
      this.halfOpenSuccessCount++;

      if (this.halfOpenSuccessCount >= this.circuitBreakerHalfOpenAttempts) {
        this.circuitBreakerState = 'closed';
        this.circuitBreakerFailures = 0;
        this.halfOpenSuccessCount = 0;

        logger.info(
          {
            type: 'presence_centrifugo_circuit_breaker_closed',
            halfOpenAttempts: this.halfOpenSuccessCount,
          },
          'Presence Centrifugo circuit breaker closed after successful half-open'
        );
        return;
      }
    }

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
        this.maxBurstSize + this.rateLimitPerSecond,
        this.tokenBucket + tokensToAdd
      );
      this.lastTokenRefill = now;
    }
  }

  private async consumeTokenDistributed(): Promise<boolean> {
    if (!this.redis) {
      return this.consumeToken();
    }

    const key = 'presence_centrifugo:rate_limit:tokens';
    const maxTokens = this.rateLimitPerSecond;
    const ttl = 1;

    try {
      const current = await this.redis.incr(key);

      if (current === 1) {
        await this.redis.expire(key, ttl);
      }

      if (current > maxTokens) {
        await this.redis.decr(key);
        return false;
      }

      return true;
    } catch (error) {
      logger.warn(
        { err: error },
        'Error in distributed rate limiting, falling back to local'
      );
      return this.consumeToken();
    }
  }

  private hasAvailableToken(): boolean {
    if (this.useDistributed) {
      return true;
    }
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
      const dataStr =
        typeof data === 'string'
          ? data
          : JSON.stringify(data, Object.keys(data as object).sort());

      const hash = createHash('sha256')
        .update(channel)
        .update(':')
        .update(dataStr)
        .digest('hex')
        .substring(0, 16);

      return `${channel}:${hash}`;
    } catch (error) {
      const errorStr = error instanceof Error ? error.message : String(error);
      const fallback = createHash('md5')
        .update(channel)
        .update(':')
        .update(errorStr)
        .update(':')
        .update(Date.now().toString())
        .digest('hex')
        .substring(0, 16);

      logger.warn(
        { channel, error },
        'Failed to generate hash, using fallback'
      );
      return `${channel}:${fallback}`;
    }
  }

  private async isDuplicatePublish(
    channel: string,
    data: unknown
  ): Promise<boolean> {
    if (this.useDistributed && this.redis) {
      const hash = this.generateHash(channel, data);
      const key = `presence_centrifugo:publish_cache:${hash}`;
      const ttlSeconds = Math.ceil(this.publishCacheWindowMs / 1000);

      try {
        const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === null;
      } catch (error) {
        logger.warn(
          { err: error, channel, hash },
          'Error checking duplicate publish, falling back to local'
        );
      }
    }

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

  private async cachePublish(channel: string, data: unknown): Promise<void> {
    if (this.useDistributed && this.redis) {
      const hash = this.generateHash(channel, data);
      const key = `presence_centrifugo:publish_cache:${hash}`;
      const ttlSeconds = Math.ceil(this.publishCacheWindowMs / 1000);
      await this.redis.expire(key, ttlSeconds).catch(() => {});
      return;
    }

    if (this.publishCache.size >= this.publishCacheMaxSize) {
      const oldestKey = this.publishCache.keys().next().value;
      if (oldestKey) {
        this.publishCache.delete(oldestKey);
      }
    }

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
    if (this.publishQueue.length === 0) {
      return;
    }

    this.queueProcessingLock = this.queueProcessingLock.then(async () => {
      if (this.isProcessingQueue) {
        return;
      }

      this.isProcessingQueue = true;

      try {
        while (this.publishQueue.length > 0 && this.hasAvailableToken()) {
          const item = this.publishQueue.shift();

          if (!item) {
            break;
          }

          const hasToken = this.useDistributed
            ? await this.consumeTokenDistributed()
            : this.consumeToken();

          if (!hasToken) {
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
    });

    await this.queueProcessingLock;
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
    if (await this.isCircuitOpen()) {
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
        await this.recordCircuitFailure();
        throw error;
      }

      const payload = (await response.json().catch(() => null)) as {
        result?: PublishResult;
        error?: { message?: string };
      } | null;

      if (payload?.error) {
        await this.recordCircuitFailure();
        throw new Error(
          `Centrifugo HTTP API error: ${payload.error.message ?? 'unknown'}`
        );
      }

      await this.recordCircuitSuccess();
      return (payload?.result ?? {}) as PublishResult;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await this.recordCircuitFailure();
        throw new Error('Centrifugo HTTP API timeout');
      }

      if (error instanceof Error && (error as { status?: number }).status) {
        throw error;
      }

      if (error instanceof Error) {
        await this.recordCircuitFailure();
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

        (async () => {
          const hasToken = this.useDistributed
            ? await this.consumeTokenDistributed()
            : this.consumeToken();

          if (hasToken) {
            this.publishViaHttpApiDirect(channel, data)
              .then(resolve)
              .catch(reject);
          } else {
            this.enqueuePublish(channel, data).then(resolve).catch(reject);
          }
        })();
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

      if (await this.isDuplicatePublish(channel, data)) {
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

      await this.cachePublish(channel, data);

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
      circuitBreakerOpen:
        this.circuitBreakerState === 'open' &&
        Date.now() < this.circuitBreakerOpenUntil,
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
