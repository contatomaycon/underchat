import 'reflect-metadata';
import { WorkerRecreateServerSlotService } from '@core/services/workerRecreateServerSlot.service';

class FakeRedisSlot {
  store = new Map<string, string>();
  expires = new Map<string, number>();
  set = jest.fn(
    async (key: string, value: string, _px: 'PX', ttlMs: number, nx: 'NX') => {
      if (nx === 'NX' && this.store.has(key)) {
        return null;
      }

      this.store.set(key, value);
      this.expires.set(key, ttlMs);
      return 'OK';
    }
  );
  get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  eval = jest.fn(
    async (
      script: string,
      _keyCount: number,
      key: string,
      token: string,
      ttlMs?: number
    ) => {
      if (script.includes('PEXPIRE')) {
        if (this.store.get(key) !== token) {
          return 0;
        }

        this.expires.set(key, Number(ttlMs));
        return 1;
      }

      if (script.includes('DEL')) {
        if (this.store.get(key) !== token) {
          return 0;
        }

        this.store.delete(key);
        this.expires.delete(key);
        return 1;
      }

      return 0;
    }
  );
}

describe('WorkerRecreateServerSlotService', () => {
  it('acquires and releases a recreate slot atomically', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);

    const lease = await service.acquire('server-1', 'worker-1:token');

    expect(lease).toEqual(
      expect.objectContaining({
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:token',
        serverId: 'server-1',
        slot: 0,
        reserved: false,
      })
    );

    await service.release(lease);

    expect(redis.store.get(lease.key)).toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      lease.key,
      lease.token
    );
  });

  it('does not release a slot owned by another token', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const lease = await service.acquire('server-1', 'worker-1:token');

    redis.store.set(lease.key, 'other-token');
    await service.release(lease);

    expect(redis.store.get(lease.key)).toBe('other-token');
  });

  it('times out when no recreate slot can be acquired', async () => {
    const redis = new FakeRedisSlot();
    redis.set.mockResolvedValue(null);
    const service = new WorkerRecreateServerSlotService(redis as never);

    await expect(
      service.acquire('server-1', 'worker-1:token', {
        acquireTimeoutMs: 1,
        retryDelayMs: 1,
      })
    ).rejects.toThrow('Timed out waiting for recreate slot on server server-1');
  });

  it('adopts and releases a reserved recreate slot', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const key = 'worker:recreate:server:server-1:slot:0';
    redis.store.set(key, 'worker-1:token');

    await expect(
      service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (lease) => {
          expect(lease.reserved).toBe(true);
          expect(lease.key).toBe(key);
          return 'done';
        },
        {
          reservedSlotKey: key,
          reservedSlotToken: 'worker-1:token',
          heartbeatIntervalMs: 60_000,
        }
      )
    ).resolves.toBe('done');

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.get(key)).toBeUndefined();
  });

  it('heartbeats while holding a recreate slot', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);

    try {
      await service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async () => {
          await jest.advanceTimersByTimeAsync(20);
          return true;
        },
        {
          heartbeatIntervalMs: 10,
        }
      );

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('PEXPIRE'),
        1,
        'worker:recreate:server:server-1:slot:0',
        expect.stringContaining('worker-1:'),
        expect.any(Number)
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
