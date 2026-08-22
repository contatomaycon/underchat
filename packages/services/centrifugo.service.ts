import { singleton, inject, container } from 'tsyringe';
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
import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { centrifugoEnvironment } from '@core/config/environments';
import {
  IQueuedPublish,
  ICachedPublish,
  ICentrifugoPublishGuard,
} from '@core/common/interfaces/ICentrifugo';

type CentrifugoPublishFailurePolicy = 'best-effort' | 'strict';

@singleton()
export class CentrifugoService {
  private readonly publishRetryAttempts = 3;
  private readonly publishRetryBaseDelayMs = 300;
  private readonly publishRetryMaxDelayMs = 2_000;
  private readonly connectTimeoutMs = 15_000;
  private readonly httpApiTimeoutMs = 15_000;
  private readonly circuitBreakerThreshold = 100;
  private readonly circuitBreakerResetMs = 30_000;
  private readonly rateLimitPerSecond = 1_000;
  private readonly queueProcessIntervalMs = 25;
  private readonly publishCacheWindowMs = 2_000;
  private readonly publishCacheCleanupIntervalMs = 5_000;

  private circuitBreakerFailures = 0;
  private circuitBreakerOpenUntil = 0;
  private tokenBucket = 100;
  private lastTokenRefill = Date.now();
  private publishQueue: IQueuedPublish[] = [];
  private publishCache = new Map<string, ICachedPublish>();
  private inFlightPublishes = new Map<string, Promise<PublishResult>>();
  private queueProcessTimer: ReturnType<typeof setInterval> | null = null;
  private cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessingQueue = false;
  private queueProcessingLock = Promise.resolve();
  private tempSubscriptions = new Map<
    string,
    { client: Centrifuge; sub: Subscription }
  >();
  private readonly circuitBreakerHalfOpenAttempts = 3;
  private readonly maxBurstSize = 100;
  private readonly publishCacheMaxSize = 10_000;
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private halfOpenSuccessCount = 0;
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
    void this.redis?.del('centrifugo:status:retry').catch(() => undefined);
    this.startQueueProcessor();
    this.startCacheCleanup();
    this.startStatusRetryWorker();
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
      const key = 'centrifugo:circuit_breaker:open_until';
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
        .del('centrifugo:circuit_breaker:failures')
        .catch(() => {});
      return false;
    }

    return this.isCircuitOpenLocal();
  }

  private isCircuitOpenLocal(): boolean {
    const now = Date.now();

    if (this.circuitBreakerState === 'open') {
      if (now >= this.circuitBreakerOpenUntil) {
        this.circuitBreakerState = 'half-open';
        this.halfOpenSuccessCount = 0;
        return false;
      }
      return true;
    }

    if (this.circuitBreakerState === 'half-open') {
      return false;
    }

    return false;
  }

  private async recordCircuitFailureForRequest(
    localOnly: boolean
  ): Promise<void> {
    if (localOnly) {
      this.recordCircuitFailureLocal();
      return;
    }
    await this.recordCircuitFailure();
  }

  private async recordCircuitSuccessForRequest(
    localOnly: boolean
  ): Promise<void> {
    if (localOnly) {
      this.recordCircuitSuccessLocal();
      return;
    }
    await this.recordCircuitSuccess();
  }

  private async recordCircuitFailure(): Promise<void> {
    if (this.useDistributed && this.redis) {
      const failuresKey = 'centrifugo:circuit_breaker:failures';
      const openUntilKey = 'centrifugo:circuit_breaker:open_until';

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
        }
      } catch {
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
      return;
    }

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerState = 'open';
      this.circuitBreakerOpenUntil = Date.now() + this.circuitBreakerResetMs;
    }
  }

  private async recordCircuitSuccess(): Promise<void> {
    if (this.useDistributed && this.redis) {
      const failuresKey = 'centrifugo:circuit_breaker:failures';
      try {
        const current = await this.redis.get(failuresKey);
        if (current && Number.parseInt(current, 10) > 0) {
          const failures = Number.parseInt(current, 10);
          if (failures > 0) {
            await this.redis.set(failuresKey, (failures - 1).toString());
          }
        }
      } catch {
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

    const key = 'centrifugo:rate_limit:tokens';
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
    } catch {
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

  private generateHash(channel: string, data: unknown): string {
    try {
      const dataStr =
        typeof data === 'string'
          ? data
          : JSON.stringify(data, (_key, value: unknown) => {
              if (
                value === null ||
                typeof value !== 'object' ||
                Array.isArray(value)
              ) {
                return value;
              }

              return Object.keys(value)
                .sort()
                .reduce<Record<string, unknown>>((sorted, key) => {
                  sorted[key] = (value as Record<string, unknown>)[key];
                  return sorted;
                }, {});
            });

      if (dataStr === undefined) {
        throw new Error('Publish payload is not JSON serializable');
      }

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
      return `${channel}:${fallback}`;
    }
  }

  private createPublishIdempotencyKey(
    channel: string,
    data: unknown,
    coalesceDuplicates: boolean,
    stableForRedelivery = false
  ): string {
    if (!coalesceDuplicates) {
      return randomUUID();
    }

    const publishHash = this.generateHash(channel, data);
    if (stableForRedelivery) {
      return createHash('sha256').update(publishHash).digest('hex');
    }

    const window = Math.floor(Date.now() / this.publishCacheWindowMs);
    return createHash('sha256')
      .update(publishHash)
      .update(':')
      .update(window.toString())
      .digest('hex');
  }

  private async isDuplicatePublish(
    channel: string,
    data: unknown
  ): Promise<boolean> {
    if (this.useDistributed && this.redis) {
      const hash = this.generateHash(channel, data);
      const key = `centrifugo:publish_cache:${hash}`;

      try {
        return (await this.redis.exists(key)) > 0;
      } catch {}
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
      const key = `centrifugo:publish_cache:${hash}`;
      const ttlSeconds = Math.ceil(this.publishCacheWindowMs / 1000);
      try {
        await this.redis.set(key, '1', 'EX', ttlSeconds);
        return;
      } catch {}
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
      void this.processQueue().catch(() => {});
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
            await item.assertActive?.();
            const result = await this.publishViaHttpApiDirect(
              item.channel,
              item.data,
              item.assertActive,
              item.idempotencyKey
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
    data: unknown,
    assertActive?: ICentrifugoPublishGuard,
    idempotencyKey?: string
  ): Promise<PublishResult> {
    return new Promise<PublishResult>((resolve, reject) => {
      this.publishQueue.push({
        channel,
        data,
        timestamp: Date.now(),
        idempotencyKey,
        assertActive,
        resolve,
        reject,
      });

      if (this.publishQueue.length > 1000) {
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
    options?: {
      assertActive?: ICentrifugoPublishGuard;
      attempts?: number;
    }
  ): Promise<PublishResult> {
    let lastError: Error | null = null;
    const attempts = Math.max(
      1,
      Math.min(
        this.publishRetryAttempts,
        options?.attempts ?? this.publishRetryAttempts
      )
    );

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await options?.assertActive?.();
        return await action();
      } catch (error) {
        const normalizedError = this.toError(error);
        lastError = normalizedError;
        const isTransient = this.isTransientError(normalizedError);
        const isLastAttempt = attempt === attempts;
        const isTimeout = this.isTimeoutError(normalizedError);

        if (!isTransient && !isTimeout) {
          throw normalizedError;
        }

        if (isLastAttempt) {
          throw normalizedError;
        }

        const backoff = Math.min(
          this.publishRetryBaseDelayMs * 2 ** (attempt - 1),
          this.publishRetryMaxDelayMs
        );

        await this.delay(backoff);
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('Centrifugo publish failed without an error');
  }

  private async publishViaHttpApiDirect(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard,
    idempotencyKey?: string,
    localCircuitOnly = false
  ): Promise<PublishResult> {
    if (
      localCircuitOnly ? this.isCircuitOpenLocal() : await this.isCircuitOpen()
    ) {
      throw new Error('Centrifugo circuit breaker is open');
    }

    const url = centrifugoEnvironment.centrifugoHttpApiUrl;
    const apiKey = centrifugoEnvironment.centrifugoHttpApiKey;

    if (!url || !apiKey) {
      throw new Error('Centrifugo HTTP API is not configured.');
    }

    await assertActive?.();
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
            ...(idempotencyKey && {
              idempotency_key: idempotencyKey,
            }),
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
        await this.recordCircuitFailureForRequest(localCircuitOnly);
        throw error;
      }

      const payload = (await response.json().catch(() => null)) as {
        result?: PublishResult;
        error?: { message?: string };
      } | null;

      if (payload?.error) {
        await this.recordCircuitFailureForRequest(localCircuitOnly);
        throw new Error(
          `Centrifugo HTTP API error: ${payload.error.message ?? 'unknown'}`
        );
      }

      if (!payload || !('result' in payload)) {
        await this.recordCircuitFailureForRequest(localCircuitOnly);
        throw new Error('Centrifugo HTTP API returned an invalid response');
      }

      await this.recordCircuitSuccessForRequest(localCircuitOnly);
      return payload.result ?? ({} as PublishResult);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await this.recordCircuitFailureForRequest(localCircuitOnly);
        throw new Error('Centrifugo HTTP API timeout');
      }

      if (error instanceof Error && (error as { status?: number }).status) {
        throw error;
      }

      if (error instanceof Error) {
        await this.recordCircuitFailureForRequest(localCircuitOnly);
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
    data: unknown,
    assertActive?: ICentrifugoPublishGuard,
    idempotencyKey?: string
  ): Promise<PublishResult> {
    await assertActive?.();
    const hasToken = this.useDistributed
      ? await this.consumeTokenDistributed()
      : this.consumeToken();
    await assertActive?.();

    return hasToken
      ? this.publishViaHttpApiDirect(
          channel,
          data,
          assertActive,
          idempotencyKey
        )
      : this.enqueuePublish(channel, data, assertActive, idempotencyKey);
  }

  private extractSubId(channel: string): string | null {
    const idx = channel.lastIndexOf('#');

    if (idx === -1) {
      return null;
    }

    return channel.slice(idx + 1);
  }

  private isTimeoutError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection timeout')
    );
  }

  private async executePublishWithPolicy(
    action: () => Promise<PublishResult>,
    context: { operation: string; channel: string },
    assertActive?: ICentrifugoPublishGuard,
    failurePolicy: CentrifugoPublishFailurePolicy = 'best-effort'
  ): Promise<PublishResult> {
    try {
      return await action();
    } catch (error) {
      const normalizedError = this.toError(error);

      // Assignment-fenced Kafka publications and durable strict callers must
      // observe the failure so they cannot commit an unconfirmed side effect.
      if (failurePolicy === 'strict' || assertActive) {
        await assertActive?.();
        throw normalizedError;
      }

      // Preserve the long-standing best-effort contract for HTTP/domain call
      // sites which may have already committed their source-of-truth write.
      console.error('[CentrifugoService] best_effort_publish_failed', {
        operation: context.operation,
        channel: context.channel,
        error: normalizedError.message,
        queueSize: this.publishQueue.length,
        circuitBreakerState: this.circuitBreakerState,
        distributed: this.useDistributed,
      });
      return {} as PublishResult;
    }
  }

  private async publishDeduplicated(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard,
    stableForRedelivery = false,
    attempts?: number,
    directHttp = false
  ): Promise<PublishResult> {
    await assertActive?.();
    const publishHash = this.generateHash(channel, data);
    const inFlightKey = stableForRedelivery
      ? `${publishHash}:stable`
      : publishHash;

    if (!assertActive) {
      const inFlight = this.inFlightPublishes.get(inFlightKey);
      if (inFlight) {
        return inFlight;
      }
    }

    if (!directHttp) {
      const duplicate = await this.isDuplicatePublish(channel, data);
      await assertActive?.();
      if (duplicate) {
        return {} as PublishResult;
      }

      // isDuplicatePublish can cross an async Redis boundary. Another local
      // caller may have started the same publication while this one was waiting.
      if (!assertActive) {
        const inFlight = this.inFlightPublishes.get(inFlightKey);
        if (inFlight) {
          return inFlight;
        }
      }
    }

    const idempotencyKey = this.createPublishIdempotencyKey(
      channel,
      data,
      true,
      stableForRedelivery || Boolean(assertActive)
    );
    const operation = (async () => {
      const result = await this.withPublishRetry(
        () =>
          directHttp
            ? this.publishViaHttpApiDirect(
                channel,
                data,
                assertActive,
                idempotencyKey,
                true
              )
            : this.publishViaHttpApi(
                channel,
                data,
                assertActive,
                idempotencyKey
              ),
        { assertActive, attempts }
      );
      if (directHttp) {
        // Centrifugo's stable idempotency key is the durable duplicate fence.
        // A distributed cache write must not extend the lease-bound publish
        // window or turn an already confirmed publication into a failure.
        void this.cachePublish(channel, data).catch(() => undefined);
      } else {
        await this.cachePublish(channel, data);
      }
      return result;
    })();

    if (!assertActive) {
      this.inFlightPublishes.set(inFlightKey, operation);
    }

    try {
      return await operation;
    } finally {
      if (this.inFlightPublishes.get(inFlightKey) === operation) {
        this.inFlightPublishes.delete(inFlightKey);
      }
    }
  }

  async publish(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard
  ): Promise<PublishResult> {
    return this.executePublishWithPolicy(
      () => this.publishDeduplicated(channel, data, assertActive),
      { operation: 'publish', channel },
      assertActive
    );
  }

  /**
   * Publishes only after the HTTP API confirms the request. Terminal transport
   * failures are propagated so a durable caller can retry the same payload.
   * The idempotency key is stable across those redeliveries.
   */
  async publishStrict(channel: string, data: unknown): Promise<PublishResult> {
    return this.executePublishWithPolicy(
      // The durable outbox owns retries. One bounded HTTP attempt per drain
      // keeps an ONLINE lease proof valid for the whole external call while
      // preserving the same Centrifugo idempotency key on redelivery.
      // Bypass the best-effort rate-limit queue: it may wait longer than the
      // lease safety margin. The outbox batch bound provides backpressure.
      () => this.publishDeduplicated(channel, data, undefined, true, 1, true),
      { operation: 'publishStrict', channel },
      undefined,
      'strict'
    );
  }

  async publishImmediate(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard
  ): Promise<PublishResult> {
    const idempotencyKey = this.createPublishIdempotencyKey(
      channel,
      data,
      false
    );
    return this.executePublishWithPolicy(
      () =>
        this.withPublishRetry(
          () =>
            this.publishViaHttpApiDirect(
              channel,
              data,
              assertActive,
              idempotencyKey
            ),
          { assertActive }
        ),
      { operation: 'publishImmediate', channel },
      assertActive
    );
  }

  async publishSub(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard
  ): Promise<PublishResult> {
    return this.executePublishWithPolicy(
      async () => {
        await assertActive?.();
        if (!this.extractSubId(channel)) {
          throw new Error('Invalid channel format for publishSub');
        }

        return this.publishDeduplicated(channel, data, assertActive);
      },
      { operation: 'publishSub', channel },
      assertActive
    );
  }

  /**
   * Subscriber-channel variant of {@link publishStrict}. Invalid channels and
   * unconfirmed transport failures are always propagated to the caller.
   */
  async publishSubStrict(
    channel: string,
    data: unknown
  ): Promise<PublishResult> {
    return this.executePublishWithPolicy(
      async () => {
        if (!this.extractSubId(channel)) {
          throw new Error('Invalid channel format for publishSubStrict');
        }

        return this.publishDeduplicated(
          channel,
          data,
          undefined,
          true,
          1,
          true
        );
      },
      { operation: 'publishSubStrict', channel },
      undefined,
      'strict'
    );
  }

  /**
   * Publishes a message immediately without debounce or deduplication.
   * Use this for critical real-time updates like message status changes.
   * Also enables history for message recovery on client reconnect.
   */
  async publishSubImmediate(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard
  ): Promise<PublishResult> {
    await assertActive?.();
    const subId = this.extractSubId(channel);

    if (!subId) {
      throw new Error('Invalid channel format for publishSubImmediate');
    }

    const idempotencyKey = this.createPublishIdempotencyKey(
      channel,
      data,
      false
    );
    return this.withPublishRetry(
      () =>
        this.publishViaHttpApiDirectWithHistory(
          channel,
          data,
          assertActive,
          idempotencyKey
        ),
      { assertActive }
    );
  }

  /**
   * Publishes directly via HTTP API with history enabled for recovery.
   * No debounce, no deduplication, no rate limiting queue.
   */
  private async publishViaHttpApiDirectWithHistory(
    channel: string,
    data: unknown,
    assertActive?: ICentrifugoPublishGuard,
    idempotencyKey?: string
  ): Promise<PublishResult> {
    if (await this.isCircuitOpen()) {
      throw new Error('Centrifugo circuit breaker is open');
    }

    const url = centrifugoEnvironment.centrifugoHttpApiUrl;
    const apiKey = centrifugoEnvironment.centrifugoHttpApiKey;

    if (!url || !apiKey) {
      throw new Error('Centrifugo HTTP API is not configured.');
    }

    await assertActive?.();
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
            ...(idempotencyKey && {
              idempotency_key: idempotencyKey,
            }),
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

      if (!payload || !('result' in payload)) {
        await this.recordCircuitFailure();
        throw new Error('Centrifugo HTTP API returned an invalid response');
      }

      await this.recordCircuitSuccess();
      return payload.result ?? ({} as PublishResult);
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

      let subscription: Subscription | null = null;
      let publicationHandler: ((ctx: PublicationContext) => void) | null = null;

      const cleanup = (): void => {
        try {
          if (subscription && publicationHandler) {
            subscription.off('publication', publicationHandler);
            if (subscription.state !== SubscriptionState.Unsubscribed) {
              subscription.unsubscribe();
            }
          }
          if (tempClient.state !== State.Disconnected) {
            tempClient.disconnect();
          }
          this.tempSubscriptions.delete(channel);
        } catch {}
      };

      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let isResolved = false;

        let onConnect: () => void;
        let onError: (err: unknown) => void;

        const safeReject = (error: Error): void => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          cleanup();
          if (timer) {
            clearTimeout(timer);
          }
          reject(error);
        };

        const safeResolve = (): void => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          if (timer) {
            clearTimeout(timer);
          }
          resolve();
        };

        onConnect = (): void => {
          try {
            subscription =
              tempClient.getSubscription(channel) ??
              tempClient.newSubscription(channel);

            publicationHandler = (ctx: PublicationContext) => {
              handler(ctx.data, ctx);
            };

            subscription.on('publication', publicationHandler);

            if (subscription.state !== SubscriptionState.Subscribed) {
              subscription.subscribe();
            }

            this.tempSubscriptions.set(channel, {
              client: tempClient,
              sub: subscription,
            });

            safeResolve();
          } catch (err) {
            safeReject(this.toError(err));
          }
        };

        onError = (err: unknown): void => {
          safeReject(this.toError(err));
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
      throw this.toError(error);
    }
  }

  cleanupOnMessageSub(channel: string): void {
    const entry = this.tempSubscriptions.get(channel);
    if (entry) {
      try {
        if (entry.sub.state !== SubscriptionState.Unsubscribed) {
          entry.sub.unsubscribe();
        }
        if (entry.client.state !== State.Disconnected) {
          entry.client.disconnect();
        }
      } catch {}
      this.tempSubscriptions.delete(channel);
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.waitForConnected();

    const subscription = this.client.getSubscription(channel);

    if (subscription && subscription.state !== SubscriptionState.Unsubscribed) {
      subscription.unsubscribe();
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

    const circuitOpen =
      this.circuitBreakerState === 'open' &&
      Date.now() < this.circuitBreakerOpenUntil;

    return {
      queueSize: this.publishQueue.length,
      availableTokens: this.tokenBucket,
      isProcessing: this.isProcessingQueue,
      debouncePending: 0,
      cacheSize: this.publishCache.size,
      circuitBreakerFailures: this.circuitBreakerFailures,
      circuitBreakerOpen: circuitOpen,
    };
  }

  private readonly statusRetryKey = 'centrifugo:status:retry:v2';
  private readonly statusRetryIntervalMs = 5_000;
  private readonly statusRetryMaxAttempts = 3;
  private readonly statusRetryBatchSize = 50;
  private statusRetryTimer: ReturnType<typeof setInterval> | null = null;

  startStatusRetryWorker(): void {
    if (this.statusRetryTimer) {
      return;
    }

    this.statusRetryTimer = setInterval(() => {
      void this.processStatusRetryQueue().catch(() => {});
    }, this.statusRetryIntervalMs);
  }

  private stopStatusRetryWorker(): void {
    if (this.statusRetryTimer) {
      clearInterval(this.statusRetryTimer);
      this.statusRetryTimer = null;
    }
  }

  private async processStatusRetryQueue(): Promise<void> {
    if (!this.redis) {
      return;
    }

    const items = await this.redis
      .rpop(this.statusRetryKey, this.statusRetryBatchSize)
      .catch(() => null);

    if (!items || items.length === 0) {
      return;
    }

    const rawItems = Array.isArray(items) ? items : [items];

    for (const raw of rawItems) {
      try {
        const item = JSON.parse(raw) as {
          channel: string;
          message_id: string;
          data: unknown;
          enqueued_at: number;
          attempts?: number;
        };

        const age = Date.now() - item.enqueued_at;
        if (age > 60_000) {
          continue;
        }

        const attempts = (item.attempts ?? 0) + 1;

        try {
          await this.publishViaHttpApiDirectWithHistory(
            item.channel,
            item.data
          );
        } catch {
          if (attempts < this.statusRetryMaxAttempts) {
            const requeue = JSON.stringify({
              ...item,
              attempts,
            });
            await this.redis
              .lpush(this.statusRetryKey, requeue)
              .catch(() => {});
          }
        }
      } catch {
        // malformed JSON, discard
      }
    }
  }

  cleanup(): void {
    this.stopQueueProcessor();
    this.stopCacheCleanup();
    this.stopStatusRetryWorker();

    this.publishCache.clear();
    this.inFlightPublishes.clear();

    for (const item of this.publishQueue) {
      item.reject(new Error('Service cleanup'));
    }

    this.publishQueue = [];

    for (const [channel] of this.tempSubscriptions.entries()) {
      this.cleanupOnMessageSub(channel);
    }
  }
}
