import 'reflect-metadata';
import { PushDeliveryQueueService } from '@core/services/pushDeliveryQueue.service';

class FakeRedis {
  status = 'ready';
  strings = new Map<string, string>();
  zsets = new Map<string, Map<string, number>>();

  set = jest.fn(
    async (
      key: string,
      value: string,
      _px?: string,
      _ttl?: number,
      mode?: string
    ) => {
      if (mode === 'NX' && this.strings.has(key)) {
        return null;
      }
      this.strings.set(key, value);
      return 'OK';
    }
  );

  get = jest.fn(async (key: string) => this.strings.get(key) ?? null);

  setex = jest.fn(async (key: string, _ttl: number, value: string) => {
    this.strings.set(key, value);
    return 'OK';
  });

  zadd = jest.fn(async (key: string, score: number, member: string) => {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    zset.set(member, Number(score));
    this.zsets.set(key, zset);
    return 1;
  });

  zrangebyscore = jest.fn(
    async (
      key: string,
      _min: string,
      max: number,
      _limitLabel?: string,
      offset?: number,
      count?: number
    ) => {
      const items = Array.from((this.zsets.get(key) ?? new Map()).entries())
        .filter(([, score]) => score <= Number(max))
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);

      if (typeof offset === 'number' && typeof count === 'number') {
        return items.slice(offset, offset + count);
      }

      return items;
    }
  );

  zrem = jest.fn(async (key: string, member: string) => {
    const zset = this.zsets.get(key);
    if (!zset?.has(member)) {
      return 0;
    }
    zset.delete(member);
    return 1;
  });

  incrby = jest.fn(async (key: string, count: number) => {
    const next = Number(this.strings.get(key) ?? 0) + count;
    this.strings.set(key, String(next));
    return next;
  });

  expire = jest.fn(async () => 1);

  del = jest.fn(async (key: string) => {
    const existed = this.strings.delete(key);
    return existed ? 1 : 0;
  });

  eval = jest.fn(
    async (_script: string, _keys: number, key: string, token: string) => {
      if (this.strings.get(key) === token) {
        this.strings.delete(key);
        return 1;
      }
      return 0;
    }
  );
}

function makeService(input?: {
  expoResult?: {
    status: 'success' | 'temporary_failure' | 'permanent_failure';
  };
  fcmResult?: { status: 'success' | 'temporary_failure' | 'permanent_failure' };
}) {
  const redis = new FakeRedis();
  const expoProvider = {
    isConfigured: jest.fn(() => true),
    sendBatch: jest.fn(async (jobs: unknown[]) =>
      jobs.map(() => input?.expoResult ?? { status: 'success' })
    ),
  };
  const fcmProvider = {
    isConfigured: jest.fn(() => true),
    send: jest.fn(async () => input?.fcmResult ?? { status: 'success' }),
  };
  const apnsProvider = {
    isConfigured: jest.fn(() => true),
    send: jest.fn(async () => ({ status: 'success' })),
  };
  const deleter = {
    deleteByEndpoint: jest.fn(async () => true),
  };

  return {
    redis,
    expoProvider,
    fcmProvider,
    apnsProvider,
    deleter,
    service: new PushDeliveryQueueService(
      redis as never,
      expoProvider as never,
      fcmProvider as never,
      apnsProvider as never,
      deleter as never
    ),
  };
}

describe('PushDeliveryQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('contains drain failures and keeps the scheduled worker running', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const drainError = new Error('Command timed out');
    const onDrainError = jest.fn();
    const drain = jest
      .spyOn(service, 'drain')
      .mockRejectedValueOnce(drainError)
      .mockResolvedValue(undefined);

    service.start(onDrainError);
    await Promise.resolve();

    expect(onDrainError).toHaveBeenCalledWith(drainError);

    await jest.advanceTimersByTimeAsync(100);
    service.stop();

    expect(drain).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not issue queue commands before Redis is ready', async () => {
    const { service, redis } = makeService();
    redis.status = 'connecting';

    await service.drain();

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('enqueues and drains expo jobs', async () => {
    const { service, redis, expoProvider } = makeService();

    const jobId = await service.enqueue({
      userId: 'user-1',
      provider: 'expo',
      endpoint: 'ExpoPushToken[token]',
      payload: { title: 'Title', body: 'Body' },
    });
    await service.drain();

    expect(expoProvider.sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ id: jobId, provider: 'expo' }),
    ]);
    expect(redis.strings.has(`push:delivery:job:${jobId}`)).toBe(false);
  });

  it('reschedules temporary failures with an incremented attempt', async () => {
    const { service, redis } = makeService({
      expoResult: { status: 'temporary_failure' },
    });

    const jobId = await service.enqueue({
      userId: 'user-1',
      provider: 'expo',
      endpoint: 'ExpoPushToken[token]',
      payload: { title: 'Title', body: 'Body' },
    });
    await service.drain();

    const stored = JSON.parse(
      redis.strings.get(`push:delivery:job:${jobId}`) ?? '{}'
    ) as { attempt?: number };
    expect(stored.attempt).toBe(1);
    expect(redis.zsets.get('push:delivery:expo:pending')?.has(jobId)).toBe(
      true
    );
  });

  it('deletes permanently failed native subscriptions and enqueues expo fallback', async () => {
    const { service, redis, deleter } = makeService({
      fcmResult: { status: 'permanent_failure' },
    });

    await service.enqueue({
      userId: 'user-1',
      provider: 'fcm',
      endpoint: 'fcm-token',
      payload: { title: 'Title', body: 'Body' },
      fallbackExpoEndpoint: 'ExpoPushToken[fallback]',
    });
    await service.drain();

    expect(deleter.deleteByEndpoint).toHaveBeenCalledWith('fcm-token', 'fcm');
    expect(redis.zsets.get('push:delivery:expo:pending')?.size).toBe(1);
  });
});
