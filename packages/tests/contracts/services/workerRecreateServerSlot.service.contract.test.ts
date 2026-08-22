import 'reflect-metadata';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  WorkerRecreateServerSlotHoldTimeoutError,
  WorkerRecreateServerSlotService,
} from '@core/services/workerRecreateServerSlot.service';
import { LockLeaseLostError } from '@core/common/functions/withLock';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';

class FakeRedisSlot {
  store = new Map<string, string>();
  expires = new Map<string, number>();
  pttl = jest.fn(
    async (key: string) =>
      this.expires.get(key) ?? (this.store.has(key) ? 180_000 : -2)
  );
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
      keyCount: number,
      ...args: Array<string | number>
    ) => {
      const keys = args.slice(0, keyCount).map(String);
      const argv = args.slice(keyCount).map(String);
      const key = keys[0];

      if (script.includes('"SET", KEYS[1]') && script.includes('KEYS[2]')) {
        const [token, ttlMs] = argv;
        if (this.store.has(key)) {
          return 0;
        }
        this.store.set(key, token);
        this.store.set(keys[1], token);
        this.expires.set(key, Number(ttlMs));
        this.expires.set(keys[1], Number(ttlMs));
        return 1;
      }

      if (script.includes('UNLINK')) {
        const token = this.store.get(keys[1]);
        if (!token) return 0;
        const deleted = this.store.get(key) === token ? 1 : 0;
        if (deleted) this.store.delete(key);
        this.store.delete(keys[1]);
        return deleted;
      }

      if (script.toLowerCase().includes('pexpire')) {
        const [token, ttlMs] = argv;
        if (this.store.get(key) !== token) {
          return 0;
        }

        this.expires.set(key, Number(ttlMs));
        if (keys[1] && this.store.get(keys[1]) === token) {
          this.store.delete(keys[1]);
        }
        return 1;
      }

      if (script.includes('DEL')) {
        const [token] = argv;
        if (this.store.get(key) !== token) {
          return 0;
        }

        this.store.delete(key);
        this.expires.delete(key);
        if (keys[1] && this.store.get(keys[1]) === token) {
          this.store.delete(keys[1]);
          this.expires.delete(keys[1]);
        }
        return 1;
      }

      return 0;
    }
  );
}

describe('WorkerRecreateServerSlotService', () => {
  it('uses bounded recovery defaults when optional environment variables are absent', () => {
    const previousWaitMs = process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS;
    const previousTtlMs = process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS;
    const previousMaxHoldMs =
      process.env.WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS;
    delete process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS;
    delete process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS;
    delete process.env.WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS;

    try {
      const service = new WorkerRecreateServerSlotService(
        new FakeRedisSlot() as never
      ) as unknown as {
        defaultAcquireTimeoutMs: number;
        defaultTtlMs: number;
        defaultMaxHoldMs: number;
      };

      expect(service.defaultAcquireTimeoutMs).toBe(2 * 60_000);
      expect(service.defaultTtlMs).toBe(2 * 60_000);
      expect(service.defaultMaxHoldMs).toBe(
        workerLifecycleBudgets.slotMaxHoldMs
      );
    } finally {
      if (previousWaitMs === undefined) {
        delete process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS;
      } else {
        process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS = previousWaitMs;
      }
      if (previousTtlMs === undefined) {
        delete process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS;
      } else {
        process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS = previousTtlMs;
      }
      if (previousMaxHoldMs === undefined) {
        delete process.env.WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS;
      } else {
        process.env.WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS = previousMaxHoldMs;
      }
    }
  });

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
      2,
      lease.key,
      `${lease.key}:reservation`,
      lease.token
    );
  });

  it('reserves at most two exact-token slots without waiting', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);

    const first = await service.tryReserve('server-1', 'worker-1:operation-1');
    const second = await service.tryReserve('server-1', 'worker-2:operation-2');
    const deferred = await service.tryReserve(
      'server-1',
      'worker-3:operation-3'
    );

    expect(first).toEqual(
      expect.objectContaining({
        slot: 0,
        token: 'worker-1:operation-1',
      })
    );
    expect(second).toEqual(
      expect.objectContaining({
        slot: 1,
        token: 'worker-2:operation-2',
      })
    );
    expect(deferred).toBeNull();
    expect(redis.store.get(first?.key ?? '')).toBe('worker-1:operation-1');
    expect(redis.store.get(second?.key ?? '')).toBe('worker-2:operation-2');
  });

  it('does not release a slot owned by another token', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const lease = await service.acquire('server-1', 'worker-1:token');

    redis.store.set(lease.key, 'other-token');
    await service.release(lease);

    expect(redis.store.get(lease.key)).toBe('other-token');
  });

  it('clears only unadopted reservations during balancer startup', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const reserved = await service.acquire('server-1', 'reserved-token', {
      reservation: true,
      ttlMs: 120_000,
    });
    const active = await service.acquire('server-2', 'active-token');

    await expect(service.clearServerSlotsOnStartup('server-1')).resolves.toBe(
      1
    );
    await expect(service.clearServerSlotsOnStartup('server-2')).resolves.toBe(
      0
    );

    expect(redis.store.has(reserved.key)).toBe(false);
    expect(redis.store.has(`${reserved.key}:reservation`)).toBe(false);
    expect(redis.store.get(active.key)).toBe(active.token);
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
        expect.stringMatching(/pexpire/i),
        1,
        'worker:recreate:server:server-1:slot:0',
        expect.stringContaining('worker-1:'),
        expect.any(String)
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases physical provisioning capacity before connection reconciliation finishes', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const occupied = await service.acquire('server-1', 'occupied:token');
    let finishReconciliation!: () => void;
    const reconciliation = new Promise<void>((resolve) => {
      finishReconciliation = resolve;
    });
    let capacityReleased!: () => void;
    const released = new Promise<void>((resolve) => {
      capacityReleased = resolve;
    });

    const first = service.withSlot(
      { serverId: 'server-1', workerId: 'worker-1' },
      async (_lease, context, control) => {
        await control.release();
        expect(control.isReleased()).toBe(true);
        expect(() => context.assertActive()).not.toThrow();
        capacityReleased();
        await reconciliation;
        return 'first-finished';
      },
      { heartbeatIntervalMs: 60_000 }
    );
    await released;

    await expect(
      service.withSlot(
        { serverId: 'server-1', workerId: 'worker-2' },
        async () => 'second-started',
        { heartbeatIntervalMs: 60_000 }
      )
    ).resolves.toBe('second-started');

    finishReconciliation();
    await expect(first).resolves.toBe('first-finished');
    await service.release(occupied);
    expect(redis.store.size).toBe(0);
  });

  it('fences the callback when the recreate slot token is replaced', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    let effectAfterLoss = false;

    try {
      await expect(
        service.withSlot(
          {
            serverId: 'server-1',
            workerId: 'worker-1',
          },
          async (lease, context) => {
            redis.store.set(lease.key, 'new-owner');
            await jest.advanceTimersByTimeAsync(10);
            context.assertActive();
            effectAfterLoss = true;
          },
          { ttlMs: 100, heartbeatIntervalMs: 10 }
        )
      ).rejects.toBeInstanceOf(LockLeaseLostError);
    } finally {
      jest.useRealTimers();
    }

    expect(effectAfterLoss).toBe(false);
    expect(redis.store.get('worker:recreate:server:server-1:slot:0')).toBe(
      'new-owner'
    );
  });

  it('does not heartbeat a slot after it has been transferred', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const lease = await service.acquire('server-1', 'worker-1:token');

    try {
      const wait = service.waitForRelease(lease, {
        pollIntervalMs: 10,
        timeoutMs: 25,
      });
      const expectation = expect(wait).rejects.toThrow(
        'Timed out waiting for recreate slot release on server server-1'
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;

      expect(
        redis.eval.mock.calls.filter(([script]) =>
          String(script).includes('PEXPIRE')
        )
      ).toHaveLength(0);
      expect(redis.store.get(lease.key)).toBe(lease.token);
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborts a slot callback and stops heartbeats after the maximum hold time', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    let observedAbort = false;

    try {
      const operation = service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (_lease, context) => {
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                try {
                  context.assertActive();
                } catch (error) {
                  reject(error);
                }
              },
              { once: true }
            );
          });
        },
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;

      expect(observedAbort).toBe(true);
      expect(redis.store.size).toBe(0);
      const heartbeatCount = redis.eval.mock.calls.filter(([script]) =>
        String(script).includes('PEXPIRE')
      ).length;
      await jest.advanceTimersByTimeAsync(100);
      expect(
        redis.eval.mock.calls.filter(([script]) =>
          String(script).includes('PEXPIRE')
        )
      ).toHaveLength(heartbeatCount);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the hold timeout even when the callback never settles', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);

    try {
      const operation = service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async () => new Promise<never>(() => undefined),
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;

      expect(redis.store.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases a nested lifecycle lock when the server slot times out', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const slotService = new WorkerRecreateServerSlotService(redis as never);
    const lifecycleService = new WorkerLifecycleLockService(redis as never);

    try {
      const operation = slotService.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (_lease, slotContext) =>
          lifecycleService.withLock(
            'worker-1',
            'recreate_worker',
            async () => new Promise<never>(() => undefined),
            {
              ttlMs: 100,
              heartbeatIntervalMs: 10,
              signal: slotContext.signal,
            }
          ),
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;
      await jest.advanceTimersByTimeAsync(0);

      await expect(lifecycleService.isLocked('worker-1')).resolves.toBe(false);
      expect(redis.store.size).toBe(0);
      const lifecycleHeartbeatCount = redis.eval.mock.calls.filter(
        ([script, keyCount, key]) =>
          String(script).includes('PEXPIRE') &&
          keyCount === 1 &&
          key === 'underchat:worker:lifecycle:lock:worker-1'
      ).length;
      await jest.advanceTimersByTimeAsync(100);
      expect(
        redis.eval.mock.calls.filter(
          ([script, keyCount, key]) =>
            String(script).includes('PEXPIRE') &&
            keyCount === 1 &&
            key === 'underchat:worker:lifecycle:lock:worker-1'
        )
      ).toHaveLength(lifecycleHeartbeatCount);
      await expect(
        lifecycleService.withLock(
          'worker-1',
          'recovery_redrive',
          async () => 'recovered',
          { ttlMs: 100, heartbeatIntervalMs: 10 }
        )
      ).resolves.toBe('recovered');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fences a nested lifecycle callback that continues after slot timeout', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const slotService = new WorkerRecreateServerSlotService(redis as never);
    const lifecycleService = new WorkerLifecycleLockService(redis as never);
    let finishExternalCall: (() => void) | undefined;
    let lateEffect = false;

    try {
      const operation = slotService.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (_lease, slotContext) =>
          lifecycleService.withLock(
            'worker-1',
            'recreate_worker',
            async (workerContext) => {
              await new Promise<void>((resolve) => {
                finishExternalCall = resolve;
              });
              workerContext.assertActive();
              lateEffect = true;
            },
            {
              ttlMs: 100,
              heartbeatIntervalMs: 10,
              signal: slotContext.signal,
            }
          ),
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;
      finishExternalCall?.();
      await jest.advanceTimersByTimeAsync(0);

      expect(lateEffect).toBe(false);
      await expect(lifecycleService.isLocked('worker-1')).resolves.toBe(false);
      expect(redis.store.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fences a late callback continuation after the observed timeout', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    let finishExternalCall: (() => void) | undefined;
    let lateEffect = false;

    try {
      const operation = service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (_lease, context) => {
          await new Promise<void>((resolve) => {
            finishExternalCall = resolve;
          });
          context.assertActive();
          lateEffect = true;
        },
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;
      finishExternalCall?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(lateEffect).toBe(false);
      expect(redis.store.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not release a newer slot owner when a timed-out callback settles', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const key = 'worker:recreate:server:server-1:slot:0';

    try {
      const operation = service.withSlot(
        {
          serverId: 'server-1',
          workerId: 'worker-1',
        },
        async (_lease, context) => {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                redis.store.set(key, 'new-owner');
                resolve();
              },
              { once: true }
            );
          });
        },
        {
          ttlMs: 100,
          heartbeatIntervalMs: 10,
          maxHoldMs: 25,
        }
      );
      const expectation = expect(operation).rejects.toBeInstanceOf(
        WorkerRecreateServerSlotHoldTimeoutError
      );

      await jest.advanceTimersByTimeAsync(30);
      await expectation;

      expect(redis.store.get(key)).toBe('new-owner');
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases a newly acquired slot when the Kafka assignment is revoked', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw revoked;
      });

    await expect(
      service.acquire('server-1', 'worker-1:token', {
        assertActive,
      })
    ).rejects.toBe(revoked);

    expect(redis.store.size).toBe(0);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      2,
      'worker:recreate:server:server-1:slot:0',
      'worker:recreate:server:server-1:slot:0:reservation',
      'worker-1:token'
    );
  });

  it('stops waiting for a transferred slot when the assignment is revoked', async () => {
    const redis = new FakeRedisSlot();
    const service = new WorkerRecreateServerSlotService(redis as never);
    const lease = await service.acquire('server-1', 'worker-1:token');
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw revoked;
      });

    await expect(
      service.waitForRelease(lease, {
        assertActive,
        timeoutMs: 60_000,
      })
    ).rejects.toBe(revoked);

    expect(redis.store.get(lease.key)).toBe(lease.token);
    expect(
      redis.eval.mock.calls.filter(([script]) =>
        String(script).includes('PEXPIRE')
      )
    ).toHaveLength(0);
  });
});
