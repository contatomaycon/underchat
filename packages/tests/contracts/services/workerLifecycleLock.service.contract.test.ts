import 'reflect-metadata';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';

class FakeRedisLock {
  value: string | null = null;
  set = jest.fn(
    async (_key: string, owner: string, _px: 'PX', _ttl: number, _nx: 'NX') => {
      if (this.value) {
        return null;
      }

      this.value = owner;
      return 'OK';
    }
  );
  eval = jest.fn(
    async (script: string, _keyCount: number, _key: string, owner: string) => {
      if (!script.includes('DEL')) {
        return this.value === owner ? 1 : 0;
      }

      if (this.value !== owner) {
        return 0;
      }

      this.value = null;
      return 1;
    }
  );
}

describe('WorkerLifecycleLockService', () => {
  it('acquires and releases a worker lifecycle lock using the owner token', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(
      service.withLock(
        'worker-1',
        'recreate_worker',
        async () => {
          expect(redis.value).toContain(':');
          return 'done';
        },
        { heartbeatIntervalMs: 60_000 }
      )
    ).resolves.toBe('done');

    expect(redis.set).toHaveBeenCalledWith(
      'underchat:worker:lifecycle:lock:worker-1',
      expect.any(String),
      'PX',
      180_000,
      'NX'
    );
    expect(redis.value).toBeNull();
  });

  it('waits until the lock can be acquired', async () => {
    const redis = new FakeRedisLock();
    redis.value = 'other-owner';
    redis.set.mockImplementationOnce(async () => null);
    redis.set.mockImplementationOnce(async (_key, owner) => {
      redis.value = owner;
      return 'OK';
    });
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(
      service.withLock('worker-1', 'cleanup_worker', async () => true, {
        retryDelayMs: 1,
        heartbeatIntervalMs: 60_000,
      })
    ).resolves.toBe(true);

    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('times out when the lock is not acquired', async () => {
    const redis = new FakeRedisLock();
    redis.value = 'other-owner';
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(
      service.withLock('worker-1', 'request_qrcode', async () => true, {
        acquireTimeoutMs: 1,
        retryDelayMs: 1,
        heartbeatIntervalMs: 60_000,
      })
    ).rejects.toThrow('Worker lifecycle lock timeout');
  });

  it('does not release a lock owned by another process', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    await service.withLock(
      'worker-1',
      'recreate_worker',
      async () => {
        redis.value = 'other-owner';
      },
      { heartbeatIntervalMs: 60_000 }
    );

    expect(redis.value).toBe('other-owner');
  });
});
