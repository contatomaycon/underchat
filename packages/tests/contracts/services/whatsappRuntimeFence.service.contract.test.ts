import 'reflect-metadata';
import Redis from 'ioredis';
import {
  IWhatsappRuntimeFence,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';

type RedisMock = Pick<Redis, 'eval' | 'get'>;

function fence(
  input: Partial<IWhatsappRuntimeFence> = {}
): IWhatsappRuntimeFence {
  return {
    worker_id: 'worker-1',
    runtime_generation: 7,
    connection_epoch: 'epoch-7',
    connection_sequence: 1,
    source_provider: 'whatsmeow',
    activated_at: 1_700_000_000_000,
    state: 'active',
    activation_order: 1,
    ...input,
  };
}

describe('WhatsappRuntimeFenceService', () => {
  it('uses one provider-neutral Redis key per worker', () => {
    expect(WhatsappRuntimeFenceService.key('worker-1')).toBe(
      'whatsapp:runtime-fence:v1:worker-1'
    );
  });

  it('begins fail-closed before PostgreSQL and finalizes only the exact pending activation', async () => {
    const redis: RedisMock = {
      eval: jest
        .fn()
        .mockResolvedValueOnce([1, 3, 1_700_000_000_123, 0, 0])
        .mockResolvedValueOnce(1),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.beginActivation({
        worker_id: 'worker-1',
        runtime_generation: 7,
        connection_epoch: 'epoch-7',
        source_provider: 'whatsmeow',
      })
    ).resolves.toEqual({
      status: 'acquired',
      activation_order: 3,
      activated_at: 1_700_000_000_123,
      connection_sequence: 0,
      active_effect_leases: 0,
    });
    const beginScript = (redis.eval as jest.Mock).mock.calls[0][0] as string;
    expect(beginScript).toContain("state = 'activating'");
    expect(beginScript).toContain("redis.call('PEXPIRE', KEYS[2]");
    expect(beginScript).toContain(
      'return {5, activation_order, activated_at, 0, active_effect_leases}'
    );
    expect(beginScript).toContain(
      "redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now_ms)"
    );
    expect(beginScript).toContain("redis.call('HDEL', KEYS[5], lease_id)");
    expect(beginScript).toContain(
      "redis.call('ZREM', KEYS[4], unpack(expired))"
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', KEYS[1], cjson.encode({"),
      5,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      'whatsapp:runtime-fence:v1:worker-1:activation-orders:7',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      '7',
      'epoch-7',
      'whatsmeow',
      'worker-1',
      '60000',
      '2592000'
    );

    await expect(
      service.finalizeActivation({
        worker_id: 'worker-1',
        runtime_generation: 7,
        connection_epoch: 'epoch-7',
        source_provider: 'whatsmeow',
        activation_order: 3,
        connection_sequence: 9,
      })
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("current.state = 'active'"),
      4,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      '7',
      'epoch-7',
      'whatsmeow',
      '3',
      '9'
    );
  });

  it('reports draining while a prior runtime still owns effect leases', async () => {
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue([5, 4, 1_700_000_000_123, 0, 2]),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.beginActivation({
        worker_id: 'worker-1',
        runtime_generation: 8,
        connection_epoch: 'epoch-8',
        source_provider: 'whatsmeow',
      })
    ).resolves.toEqual({
      status: 'draining',
      activation_order: 4,
      activated_at: 1_700_000_000_123,
      connection_sequence: 0,
      active_effect_leases: 2,
    });
  });

  it('acquires and releases an exact runtime effect lease with owner-token CAS', async () => {
    const active = fence();
    const redis: RedisMock = {
      eval: jest
        .fn()
        .mockResolvedValueOnce([1, JSON.stringify(active), Date.now() + 45_000])
        .mockResolvedValueOnce(1),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    const lease = await service.acquireEffectLease(active);
    expect(lease?.fence).toEqual(active);
    expect(redis.eval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        "redis.call('HSET', KEYS[3], lease_id, owner_token)"
      ),
      3,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      'worker-1',
      '7',
      'epoch-7',
      'whatsmeow',
      expect.any(String),
      expect.any(String),
      '45000',
      '3600000'
    );

    expect(lease).not.toBeNull();
    await expect(lease?.release()).resolves.toBe(true);
    expect(redis.eval).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "redis.call('HGET', KEYS[2], lease_id) ~= owner_token"
      ),
      2,
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      expect.any(String),
      expect.any(String)
    );
  });

  it('honors an effect-lease TTL override while capping heartbeat at the safety limit', async () => {
    const previousTtl = process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS;
    const previousHeartbeat =
      process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS;
    process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS = '120000';
    process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS = '999999';
    try {
      const active = fence();
      const redis: RedisMock = {
        eval: jest
          .fn()
          .mockResolvedValueOnce([
            1,
            JSON.stringify(active),
            Date.now() + 120_000,
          ])
          .mockResolvedValueOnce(1),
        get: jest.fn(),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      const lease = await service.acquireEffectLease(active);

      expect(redis.eval).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        3,
        'whatsapp:runtime-fence:v1:worker-1',
        'whatsapp:runtime-fence:v1:worker-1:effect-leases',
        'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
        'worker-1',
        '7',
        'epoch-7',
        'whatsmeow',
        expect.any(String),
        expect.any(String),
        '120000',
        '3600000'
      );
      expect(
        (
          lease as unknown as {
            heartbeatMs: number;
          }
        ).heartbeatMs
      ).toBe(15_000);
      await expect(lease?.release()).resolves.toBe(true);
    } finally {
      if (previousTtl === undefined) {
        delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS;
      } else {
        process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS = previousTtl;
      }
      if (previousHeartbeat === undefined) {
        delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS;
      } else {
        process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS =
          previousHeartbeat;
      }
    }
  });

  it('fails closed and stops renewing when Redis no longer owns the lease', async () => {
    const previousTtl = process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS;
    const previousHeartbeat =
      process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS;
    delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS;
    delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS;
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    try {
      const active = fence();
      const redis: RedisMock = {
        eval: jest
          .fn()
          .mockResolvedValueOnce([
            1,
            JSON.stringify(active),
            Date.now() + 45_000,
          ])
          .mockResolvedValueOnce([0])
          .mockResolvedValueOnce(0),
        get: jest.fn(),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);
      const lease = await service.acquireEffectLease(active);
      if (!lease) {
        throw new Error('expected effect lease');
      }

      await jest.advanceTimersByTimeAsync(5_000);

      expect(redis.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        2,
        'whatsapp:runtime-fence:v1:worker-1:effect-leases',
        'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
        expect.any(String),
        expect.any(String),
        '45000',
        '3600000'
      );
      expect(() => lease.assertOwned()).toThrow(
        'WhatsApp runtime effect lease is no longer owned'
      );
      expect(jest.getTimerCount()).toBe(0);
      await expect(lease.release()).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
      if (previousTtl === undefined) {
        delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS;
      } else {
        process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS = previousTtl;
      }
      if (previousHeartbeat === undefined) {
        delete process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS;
      } else {
        process.env.WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS =
          previousHeartbeat;
      }
    }
  });

  it('rejects a browser/socket event without a complete active fence', async () => {
    const redis: RedisMock = {
      eval: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.isCurrent({
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
      })
    ).resolves.toBe(false);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('accepts only the active generation, epoch and provider', async () => {
    const active = fence();
    const redis: RedisMock = {
      eval: jest.fn(),
      get: jest.fn().mockResolvedValue(JSON.stringify(active)),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(service.isCurrent(active)).resolves.toBe(true);
    await expect(
      service.isCurrent({
        ...active,
        connection_epoch: 'stale-epoch',
      })
    ).resolves.toBe(false);
    await expect(
      service.isCurrent({
        ...active,
        runtime_generation: 6,
      })
    ).resolves.toBe(false);
    await expect(
      service.isCurrent({
        ...active,
        source_provider: 'baileys',
      })
    ).resolves.toBe(false);
  });

  it('fails closed while an activation is pending', async () => {
    const redis: RedisMock = {
      eval: jest.fn(),
      get: jest.fn().mockResolvedValue(
        JSON.stringify({
          ...fence(),
          state: 'activating',
          connection_sequence: 0,
        })
      ),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(service.view('worker-1')).resolves.toBeNull();
    await expect(service.isCurrent(fence())).resolves.toBe(false);
  });

  it.each(['active', 'activating'] as const)(
    'exposes the %s durable generation as a provisioning floor',
    async (state) => {
      const redis: RedisMock = {
        eval: jest.fn(),
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            ...fence({ runtime_generation: 89 }),
            state,
            connection_sequence: state === 'active' ? 33 : 0,
          })
        ),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      await expect(
        service.viewRuntimeGenerationFloor('worker-1')
      ).resolves.toBe(89);
    }
  );

  it.each(['revoked', 'deleting', 'invalid'] as const)(
    'blocks provisioning over a %s runtime-fence state',
    async (state) => {
      const redis: RedisMock = {
        eval: jest.fn(),
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            worker_id: 'worker-1',
            state,
            runtime_generation: 89,
          })
        ),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      await expect(
        service.viewRuntimeGenerationFloor('worker-1')
      ).rejects.toThrow(
        'WhatsApp runtime generation floor blocks provisioning'
      );
    }
  );

  it.each([
    ['active', JSON.stringify(fence()), 'active'],
    [
      'activating',
      JSON.stringify({
        ...fence(),
        state: 'activating',
        connection_sequence: 0,
      }),
      'activating',
    ],
    [
      'revoked',
      JSON.stringify({
        worker_id: 'worker-1',
        state: 'revoked',
        revoked_at: 1_700_000_000_000,
      }),
      'revoked',
    ],
    [
      'deleting',
      JSON.stringify({
        worker_id: 'worker-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'delete-1',
        state: 'deleting',
        revoked_at: 1_700_000_000_000,
      }),
      'deleting',
    ],
    ['missing', null, 'missing'],
    ['malformed', '{not-json', 'invalid'],
  ] as const)(
    'reports the %s lifecycle admission state without collapsing terminal tombstones',
    async (_label, raw, expectedState) => {
      const redis: RedisMock = {
        eval: jest.fn(),
        get: jest.fn().mockResolvedValue(raw),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      const admission = await service.viewAdmissionState('worker-1');

      expect(admission.state).toBe(expectedState);
      if (expectedState === 'active') {
        expect(admission).toEqual({ state: 'active', fence: fence() });
      }
      if (expectedState === 'revoked' || expectedState === 'deleting') {
        expect(admission).toEqual({
          state: expectedState,
          worker_id: 'worker-1',
        });
      }
    }
  );

  it('keeps an admission Redis failure retryable instead of inventing a lifecycle state', async () => {
    const redis: RedisMock = {
      eval: jest.fn(),
      get: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(service.viewAdmissionState('worker-1')).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: 'runtime_fence_admission_view',
    });
  });

  it('atomically writes a Redis value only for the current runtime', async () => {
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);
    const active = fence();

    await expect(
      service.setValueIfCurrent(
        active,
        'phone_validation:request-1',
        '{"valid":true}',
        30
      )
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining(
        "redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])"
      ),
      2,
      'whatsapp:runtime-fence:v1:worker-1',
      'phone_validation:request-1',
      '7',
      'epoch-7',
      'whatsmeow',
      '{"valid":true}',
      '30'
    );
  });

  it('does not require a worker runtime fence for official events', async () => {
    const redis: RedisMock = {
      eval: jest.fn(),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.isCurrent({
        source_provider: 'official_whatsapp',
      })
    ).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('rejects missing or unknown providers in strict post-rollout mode', async () => {
    const previous = process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS;
    process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS = 'true';
    try {
      const redis: RedisMock = {
        eval: jest.fn(),
        get: jest.fn(),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      await expect(service.isCurrent({ worker_id: 'worker-1' })).resolves.toBe(
        false
      );
      await expect(
        service.isCurrent({
          worker_id: 'worker-1',
          source_provider: 'browser_typo',
        })
      ).resolves.toBe(false);
      await expect(
        service.isCurrent({ source_provider: 'official_whatsapp' })
      ).resolves.toBe(true);
      expect(redis.get).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS;
      } else {
        process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS = previous;
      }
    }
  });

  it('cannot disable strict runtime fencing by omitting or disabling the flag in production', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousStrict = process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS;
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS = 'false';
    try {
      const redis: RedisMock = {
        eval: jest.fn(),
        get: jest.fn(),
      };
      const service = new WhatsappRuntimeFenceService(redis as Redis);

      await expect(service.isCurrent({ worker_id: 'worker-1' })).resolves.toBe(
        false
      );
      expect(redis.get).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
      if (previousStrict === undefined) {
        delete process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS;
      } else {
        process.env.WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS = previousStrict;
      }
    }
  });

  it('only deactivates the matching generation and connection epoch', async () => {
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(service.deactivate('worker-1', 7, 'epoch-7')).resolves.toBe(
      true
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      2,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      '7',
      'epoch-7'
    );
  });

  it('durably revokes a worker runtime and its effect leases', async () => {
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(service.revoke('worker-1')).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('state = incoming_state'),
      4,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      'worker-1',
      'revoked',
      '',
      ''
    );
  });

  it('records and confirms an exact idempotent deletion revocation', async () => {
    const revoked = {
      state: 'deleting',
      worker_id: 'worker-1',
      account_id: 'account-1',
      lifecycle_operation_id: 'delete-operation-1',
      revoked_at: 1_700_000_000_000,
    };
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue(0),
      get: jest.fn().mockResolvedValue(JSON.stringify(revoked)),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.revokeForDeletion('worker-1', 'account-1', 'delete-operation-1')
    ).resolves.toBe(true);
    await expect(
      service.assertDeletionRevoked(
        'worker-1',
        'account-1',
        'delete-operation-1'
      )
    ).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("incoming_state == 'deleting'"),
      4,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      'worker-1',
      'deleting',
      'account-1',
      'delete-operation-1'
    );
  });

  it('fails closed when deletion revocation conflicts or cannot be confirmed', async () => {
    const redis: RedisMock = {
      eval: jest.fn().mockResolvedValue(-1),
      get: jest.fn().mockResolvedValue(null),
    };
    const service = new WhatsappRuntimeFenceService(redis as Redis);

    await expect(
      service.revokeForDeletion('worker-1', 'account-1', 'delete-operation-1')
    ).rejects.toThrow('revocation conflict');
    await expect(
      service.assertDeletionRevoked(
        'worker-1',
        'account-1',
        'delete-operation-1'
      )
    ).rejects.toThrow('was not confirmed');
  });
});
