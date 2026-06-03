import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import {
  IPushDeliveryInput,
  IPushDeliveryJob,
  IPushDeliveryResult,
  MobilePushSubscriptionProvider,
} from '@core/common/interfaces/IPushDelivery';
import { releaseLock } from '@core/common/functions/releaseLock';
import { PushExpoProviderService } from './pushExpoProvider.service';
import { PushFcmProviderService } from './pushFcmProvider.service';
import { PushApnsProviderService } from './pushApnsProvider.service';
import {
  incrementCounter,
  recordGauge,
} from '@core/plugins/telemetry/observability';

const MOBILE_PROVIDERS: MobilePushSubscriptionProvider[] = [
  'expo',
  'fcm',
  'apns',
];

const PROVIDER_RATE_LIMITS: Record<MobilePushSubscriptionProvider, number> = {
  expo: Number(process.env.PUSH_EXPO_RATE_LIMIT_PER_SECOND ?? 550),
  fcm: Number(process.env.PUSH_FCM_RATE_LIMIT_PER_SECOND ?? 9000),
  apns: Number(process.env.PUSH_APNS_RATE_LIMIT_PER_SECOND ?? 1000),
};

const PROVIDER_DRAIN_BATCH_SIZE: Record<
  MobilePushSubscriptionProvider,
  number
> = {
  expo: PushExpoProviderService.MAX_BATCH_SIZE,
  fcm: Number(process.env.PUSH_FCM_DRAIN_BATCH_SIZE ?? 1000),
  apns: Number(process.env.PUSH_APNS_DRAIN_BATCH_SIZE ?? 500),
};

const JOB_TTL_SECONDS = Number(
  process.env.PUSH_DELIVERY_JOB_TTL_SECONDS ?? 86400
);
const MAX_ATTEMPTS = Number(process.env.PUSH_DELIVERY_MAX_ATTEMPTS ?? 5);
const MIN_BACKOFF_MS = Number(process.env.PUSH_DELIVERY_MIN_BACKOFF_MS ?? 1000);
const MAX_BACKOFF_MS = Number(
  process.env.PUSH_DELIVERY_MAX_BACKOFF_MS ?? 60000
);
const LOCK_TTL_MS = Number(process.env.PUSH_DELIVERY_LOCK_TTL_MS ?? 5000);
const DRAIN_INTERVAL_MS = Number(
  process.env.PUSH_DELIVERY_DRAIN_INTERVAL_MS ?? 100
);
const PROVIDER_CONCURRENCY: Record<MobilePushSubscriptionProvider, number> = {
  expo: 1,
  fcm: Number(process.env.PUSH_FCM_CONCURRENCY ?? 100),
  apns: Number(process.env.PUSH_APNS_CONCURRENCY ?? 50),
};

@singleton()
export class PushDeliveryQueueService {
  private interval: NodeJS.Timeout | null = null;
  private isDraining = false;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(PushExpoProviderService)
    private readonly pushExpoProviderService: PushExpoProviderService,
    @inject(PushFcmProviderService)
    private readonly pushFcmProviderService: PushFcmProviderService,
    @inject(PushApnsProviderService)
    private readonly pushApnsProviderService: PushApnsProviderService,
    @inject(PushSubscriptionDeleterRepository)
    private readonly pushSubscriptionDeleterRepository: PushSubscriptionDeleterRepository
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.drain();
    }, DRAIN_INTERVAL_MS);
    void this.drain();
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  isProviderConfigured(provider: MobilePushSubscriptionProvider): boolean {
    if (provider === 'expo') {
      return this.pushExpoProviderService.isConfigured();
    }

    if (provider === 'fcm') {
      return this.pushFcmProviderService.isConfigured();
    }

    return this.pushApnsProviderService.isConfigured();
  }

  enqueue = async (input: IPushDeliveryInput): Promise<string> => {
    const id = randomUUID();
    const job: IPushDeliveryJob = {
      id,
      userId: input.userId,
      provider: input.provider,
      endpoint: input.endpoint,
      payload: input.payload,
      attempt: 0,
      createdAt: Date.now(),
      fallbackExpoEndpoint: input.fallbackExpoEndpoint,
    };

    await this.persistJob(job);
    await this.redis.zadd(this.pendingKey(input.provider), Date.now(), id);
    incrementCounter('push_delivery_enqueued', 1, {
      provider: input.provider,
    });
    return id;
  };

  drain = async (): Promise<void> => {
    if (this.isDraining) {
      return;
    }

    this.isDraining = true;
    try {
      await Promise.all(
        MOBILE_PROVIDERS.map((provider) => this.drainProvider(provider))
      );
    } finally {
      this.isDraining = false;
    }
  };

  private async drainProvider(
    provider: MobilePushSubscriptionProvider
  ): Promise<void> {
    const lockKey = this.lockKey(provider);
    const lockToken = randomUUID();
    const acquired = await this.redis.set(
      lockKey,
      lockToken,
      'PX',
      LOCK_TTL_MS,
      'NX'
    );

    if (acquired !== 'OK') {
      return;
    }

    try {
      const available = await this.getAvailableCapacity(provider);
      if (available <= 0) {
        return;
      }

      const jobs = await this.claimDueJobs(
        provider,
        Math.min(available, PROVIDER_DRAIN_BATCH_SIZE[provider])
      );
      if (jobs.length === 0) {
        return;
      }

      await this.reserveCapacity(provider, jobs.length);
      recordGauge('push_delivery_claimed', jobs.length, { provider });

      const results = await this.deliverJobs(provider, jobs);
      await Promise.all(
        jobs.map((job, index) =>
          this.finalizeJob(
            job,
            results[index] ?? {
              status: 'temporary_failure',
              reason: 'missing_delivery_result',
            }
          )
        )
      );
    } finally {
      await releaseLock(this.redis, lockKey, lockToken).catch(() => {});
    }
  }

  private async claimDueJobs(
    provider: MobilePushSubscriptionProvider,
    limit: number
  ): Promise<IPushDeliveryJob[]> {
    const ids = await this.redis.zrangebyscore(
      this.pendingKey(provider),
      '-inf',
      Date.now(),
      'LIMIT',
      0,
      limit
    );

    const jobs: IPushDeliveryJob[] = [];
    for (const id of ids) {
      const removed = await this.redis.zrem(this.pendingKey(provider), id);
      if (removed === 0) {
        continue;
      }

      const job = await this.readJob(id);
      if (!job || job.provider !== provider) {
        continue;
      }

      jobs.push(job);
    }

    return jobs;
  }

  private async deliverJobs(
    provider: MobilePushSubscriptionProvider,
    jobs: IPushDeliveryJob[]
  ): Promise<IPushDeliveryResult[]> {
    if (provider === 'expo') {
      return this.pushExpoProviderService.sendBatch(jobs);
    }

    if (provider === 'fcm') {
      return this.mapWithConcurrency(jobs, PROVIDER_CONCURRENCY.fcm, (job) =>
        this.pushFcmProviderService.send(job)
      );
    }

    return this.mapWithConcurrency(jobs, PROVIDER_CONCURRENCY.apns, (job) =>
      this.pushApnsProviderService.send(job)
    );
  }

  private async finalizeJob(
    job: IPushDeliveryJob,
    result: IPushDeliveryResult
  ): Promise<void> {
    if (result.status === 'success') {
      await this.redis.del(this.jobKey(job.id));
      incrementCounter('push_delivery_success', 1, { provider: job.provider });
      return;
    }

    if (result.status === 'permanent_failure') {
      await this.pushSubscriptionDeleterRepository.deleteByEndpoint(
        job.endpoint,
        job.provider
      );
      await this.redis.del(this.jobKey(job.id));
      incrementCounter('push_delivery_permanent_failure', 1, {
        provider: job.provider,
        reason: result.reason,
      });

      if (job.provider !== 'expo' && job.fallbackExpoEndpoint) {
        await this.enqueue({
          userId: job.userId,
          provider: 'expo',
          endpoint: job.fallbackExpoEndpoint,
          payload: job.payload,
        });
      }
      return;
    }

    const nextAttempt = job.attempt + 1;
    const nextJob: IPushDeliveryJob = {
      ...job,
      attempt: nextAttempt,
    };

    if (nextAttempt >= MAX_ATTEMPTS) {
      await this.persistJob(nextJob);
      await this.redis.zadd(
        this.deadletterKey(job.provider),
        Date.now(),
        job.id
      );
      incrementCounter('push_delivery_deadletter', 1, {
        provider: job.provider,
        reason: result.reason,
      });
      return;
    }

    const retryAt = Date.now() + this.getBackoffMs(nextAttempt);
    await this.persistJob(nextJob);
    await this.redis.zadd(this.pendingKey(job.provider), retryAt, job.id);
    incrementCounter('push_delivery_retry_scheduled', 1, {
      provider: job.provider,
      reason: result.reason,
    });
  }

  private async getAvailableCapacity(
    provider: MobilePushSubscriptionProvider
  ): Promise<number> {
    const limit = PROVIDER_RATE_LIMITS[provider];
    const current = Number((await this.redis.get(this.rateKey(provider))) ?? 0);
    return Math.max(limit - current, 0);
  }

  private async reserveCapacity(
    provider: MobilePushSubscriptionProvider,
    count: number
  ): Promise<void> {
    const key = this.rateKey(provider);
    const current = await this.redis.incrby(key, count);
    if (current === count) {
      await this.redis.expire(key, 2);
    }
  }

  private async persistJob(job: IPushDeliveryJob): Promise<void> {
    await this.redis.setex(
      this.jobKey(job.id),
      JOB_TTL_SECONDS,
      JSON.stringify(job)
    );
  }

  private async readJob(id: string): Promise<IPushDeliveryJob | null> {
    const raw = await this.redis.get(this.jobKey(id));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IPushDeliveryJob;
      if (
        !parsed.id ||
        !parsed.provider ||
        !parsed.endpoint ||
        !parsed.payload
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private getBackoffMs(attempt: number): number {
    const base = Math.min(
      MAX_BACKOFF_MS,
      MIN_BACKOFF_MS * 2 ** Math.max(attempt - 1, 0)
    );
    const jitter = Math.floor(Math.random() * Math.floor(base * 0.2));
    return base + jitter;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await mapper(items[index]);
        }
      })
    );

    return results;
  }

  private pendingKey(provider: MobilePushSubscriptionProvider): string {
    return `push:delivery:${provider}:pending`;
  }

  private deadletterKey(provider: MobilePushSubscriptionProvider): string {
    return `push:delivery:${provider}:deadletter`;
  }

  private jobKey(id: string): string {
    return `push:delivery:job:${id}`;
  }

  private lockKey(provider: MobilePushSubscriptionProvider): string {
    return `push:delivery:${provider}:lock`;
  }

  private rateKey(provider: MobilePushSubscriptionProvider): string {
    return `push:delivery:${provider}:rate:${Math.floor(Date.now() / 1000)}`;
  }
}
