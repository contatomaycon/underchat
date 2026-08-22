import 'reflect-metadata';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { LockLeaseLostError } from '@core/common/functions/withLock';

class FakeRedisLock {
  value: string | null = null;
  ttlMs: number | null = null;
  pttl = jest.fn(async () => (this.value ? (this.ttlMs ?? 180_000) : -2));
  set = jest.fn(
    async (_key: string, owner: string, _px: 'PX', ttl: number, _nx: 'NX') => {
      if (this.value) {
        return null;
      }

      this.value = owner;
      this.ttlMs = ttl;
      return 'OK';
    }
  );
  eval = jest.fn(
    async (
      script: string,
      _keyCount: number,
      _key: string,
      owner: string,
      requestedTtl?: number
    ) => {
      if (script.includes('worker-lifecycle-redrive-bound-ttl-v1')) {
        if (
          (this.value !== owner && !this.value?.startsWith(`${owner}:`)) ||
          requestedTtl === undefined
        ) {
          return 0;
        }
        if (this.ttlMs === null || this.ttlMs > requestedTtl) {
          this.ttlMs = requestedTtl;
          return 1;
        }
        return 0;
      }

      if (!script.includes('DEL')) {
        return this.value === owner ? 1 : 0;
      }

      if (this.value !== owner) {
        return 0;
      }

      this.value = null;
      this.ttlMs = null;
      return 1;
    }
  );
}

describe('WorkerLifecycleLockService', () => {
  it('reports whether the lifecycle lock is currently active', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(service.isLocked('worker-1')).resolves.toBe(false);
    redis.value = 'active-owner';
    await expect(service.isLocked('worker-1')).resolves.toBe(true);

    expect(redis.pttl).toHaveBeenCalledWith(
      'underchat:worker:lifecycle:lock:worker-1'
    );
  });

  it('claims and conditionally releases a lifecycle redrive cooldown', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    const claimToken = await service.tryClaimRedrive(
      'worker-1',
      'operation-1',
      15_000
    );
    expect(claimToken).toMatch(/^operation-1:[0-9a-f-]{36}$/u);
    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 15_000)
    ).resolves.toBeNull();

    await expect(
      service.releaseRedriveClaim(
        'worker-1',
        'operation-1',
        claimToken ?? undefined
      )
    ).resolves.toBe(true);
    expect(redis.value).toBeNull();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      'underchat:worker:lifecycle:redrive:worker-1:operation-1',
      claimToken
    );
  });

  it('monotonically shortens an existing claim for the same operation', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 15 * 60_000)
    ).resolves.toEqual(expect.stringMatching(/^operation-1:/u));
    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 30_000)
    ).resolves.toBeNull();

    expect(redis.ttlMs).toBe(30_000);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('worker-lifecycle-redrive-bound-ttl-v1'),
      1,
      'underchat:worker:lifecycle:redrive:worker-1:operation-1',
      'operation-1',
      30_000
    );
  });

  it('shortens a legacy operation claim but never releases it without an owned token', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);
    redis.value = 'operation-1';
    redis.ttlMs = 15 * 60_000;

    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 30_000)
    ).resolves.toBeNull();
    expect(redis.ttlMs).toBe(30_000);
    const evalCallsAfterBoundTtl = redis.eval.mock.calls.length;

    await expect(
      service.releaseRedriveClaim('worker-1', 'operation-1')
    ).resolves.toBe(false);
    expect(redis.value).toBe('operation-1');
    expect(redis.eval).toHaveBeenCalledTimes(evalCallsAfterBoundTtl);
  });

  it('does not alter a redrive claim with unexpected ownership evidence', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);
    redis.value = 'other-operation';
    redis.ttlMs = 15 * 60_000;

    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 30_000)
    ).resolves.toBeNull();

    expect(redis.value).toBe('other-operation');
    expect(redis.ttlMs).toBe(15 * 60_000);
  });

  it('never extends an existing shorter redrive claim', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 10_000)
    ).resolves.toEqual(expect.stringMatching(/^operation-1:/u));
    await expect(
      service.tryClaimRedrive('worker-1', 'operation-1', 30_000)
    ).resolves.toBeNull();

    expect(redis.ttlMs).toBe(10_000);
  });

  it('does not let a delayed owner release a newer same-operation claim after ABA', async () => {
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);
    const first = await service.tryClaimRedrive(
      'worker-1',
      'operation-1',
      10_000
    );
    expect(first).toBeTruthy();

    // Simulate TTL expiry followed by a new owner claiming the same operation.
    redis.value = null;
    redis.ttlMs = null;
    const second = await service.tryClaimRedrive(
      'worker-1',
      'operation-1',
      10_000
    );
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    await expect(
      service.releaseRedriveClaim('worker-1', 'operation-1', first ?? undefined)
    ).resolves.toBe(false);
    expect(redis.value).toBe(second);

    await expect(
      service.releaseRedriveClaim(
        'worker-1',
        'operation-1',
        second ?? undefined
      )
    ).resolves.toBe(true);
    expect(redis.value).toBeNull();
  });

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
    jest.useFakeTimers();
    const redis = new FakeRedisLock();
    const service = new WorkerLifecycleLockService(redis as never);

    try {
      await expect(
        service.withLock(
          'worker-1',
          'recreate_worker',
          async (context) => {
            redis.value = 'other-owner';
            await jest.advanceTimersByTimeAsync(10);
            context.assertActive();
          },
          { ttlMs: 100, heartbeatIntervalMs: 10 }
        )
      ).rejects.toBeInstanceOf(LockLeaseLostError);
    } finally {
      jest.useRealTimers();
    }

    expect(redis.value).toBe('other-owner');
  });
});
