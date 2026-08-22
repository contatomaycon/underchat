import 'reflect-metadata';

import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';

describe('MessageStatusPendingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const makeService = () => {
    const redis = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      hget: jest.fn().mockResolvedValue(null),
      hmget: jest.fn(),
      hscan: jest.fn().mockResolvedValue(['0', []]),
      zscan: jest.fn().mockResolvedValue(['0', []]),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      zadd: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue(null),
      zrangebyscore: jest.fn().mockResolvedValue([]),
      zrem: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
      time: jest.fn().mockResolvedValue(['1', '0']),
      del: jest.fn().mockResolvedValue(0),
    };
    redis.hmget.mockImplementation(async (key: string, ...members: string[]) =>
      Promise.all(members.map((member) => redis.hget(key, member)))
    );

    const service = new MessageStatusPendingService(redis as never);

    return {
      redis,
      service,
    };
  };

  const makeStatusUpdate = (
    patch: IMessageStatusUpdate['patch'] = { is_sent: true }
  ): IMessageStatusUpdate => ({
    account_id: 'acc-1',
    worker_id: 'worker-1',
    message_id: 'wa-1',
    patch,
    retry_count: 0,
    first_seen_at: 1000,
  });

  it('stores a fresh pending status with a stable key and reset retry lifecycle', async () => {
    const { redis, service } = makeService();

    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate({ is_delivered: true }),
        retry_count: 1,
      })
    );

    await service.deferMissingStatusUpdate(
      makeStatusUpdate({ is_seen: true }),
      { is_seen: true },
      { batchSize: 2, duration: 10 }
    );

    const storeCall = redis.eval.mock.calls[0];
    expect(storeCall).toEqual(
      expect.arrayContaining([
        'message-status:update:pending:v2:payloads',
        'message-status:update:pending:v2:retry',
        'acc-1:worker-1:wa-1',
      ])
    );
    const payload = JSON.parse(storeCall[9]);
    expect(payload.retry_count).toBe(1);
    expect(payload.pending_retry_version).toEqual(expect.any(String));
    expect(payload.patch).toEqual({
      is_delivered: true,
      is_seen: true,
      is_sent: true,
    });
    expect(storeCall[0]).toEqual(expect.stringContaining("redis.call('TIME')"));
    expect(storeCall[10]).toBe('2000');
  });

  it('wakes a pending status using the same stable key', async () => {
    const { redis, service } = makeService();
    const payload = makeStatusUpdate({ is_delivered: true });
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    await service.wakePendingStatus('acc-1', 'wa-1', 'worker-1');

    const wakeCall = redis.eval.mock.calls[0];
    expect(wakeCall[0]).toEqual(expect.stringContaining("redis.call('TIME')"));
    expect(wakeCall.slice(1, 9)).toEqual([
      5,
      'message-status:update:pending:v2:payloads',
      'message-status:update:pending:v2:retry',
      'message-status:update:pending:v2:parking',
      'message-status:update:pending:v2:processing',
      'message-status:update:pending:v2:claims',
      'acc-1:worker-1:wa-1',
      JSON.stringify(payload),
    ]);
    expect(JSON.parse(wakeCall[9])).toEqual({
      ...payload,
      pending_retry_version: expect.any(String),
    });
    expect(wakeCall.slice(10)).toEqual(['0', '0']);
  });

  it('parks exhausted retries without discarding the pending payload', async () => {
    const { redis, service } = makeService();
    const payload = {
      ...makeStatusUpdate({ is_seen: true }),
      retry_count: 8,
    };

    await service.parkPendingStatus(payload);

    const storeCall = redis.eval.mock.calls[0];
    expect(storeCall[11]).toBe('1');
    const parkedPayload = JSON.parse(storeCall[9]);
    expect(parkedPayload.parked_at).toEqual(expect.any(Number));
  });

  it('lets a positive ACK supersede a pending failure for the same worker message', async () => {
    const { redis, service } = makeService();
    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate({}),
        failed: true,
        retry_count: 1,
      })
    );

    await service.deferMissingStatusUpdate(
      makeStatusUpdate({ is_delivered: true }),
      { is_delivered: true },
      { batchSize: 1, duration: 10 }
    );

    const payload = JSON.parse(redis.eval.mock.calls[0][9]);
    expect(payload.failed).toBe(false);
    expect(payload.patch).toEqual({
      is_sent: true,
      is_delivered: true,
    });
  });

  it('tracks a durable failed status independently from positive ACK patches', async () => {
    const { redis, service } = makeService();
    const failedUpdate = { ...makeStatusUpdate({}), failed: true };

    await service.markApplied(failedUpdate, 'internal-message-1');

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      7,
      'message-status:update:applied:acc-1:worker-1:wa-1',
      'message-status:update:alias:acc-1:worker-1:wa-1',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'acc-1',
      'worker-1',
      'wa-1',
      'internal-message-1',
      '0',
      '0',
      '0',
      '1',
      '',
      '',
      '0'
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining("redis.call('TIME')")
    );
    const ledger = JSON.stringify({
      account_id: 'acc-1',
      worker_id: 'worker-1',
      message_id: 'wa-1',
      internal_message_id: 'internal-message-1',
      patch: {},
      failed: true,
      applied_at: Date.now(),
    });
    redis.get.mockResolvedValue(ledger);
    await expect(service.isApplied(failedUpdate)).resolves.toBe(true);
    await expect(
      service.isApplied({ ...failedUpdate, failed: false })
    ).resolves.toBe(true);
  });

  it('treats an already applied read receipt as covering a late failure', async () => {
    const { redis, service } = makeService();
    redis.get.mockResolvedValue(
      JSON.stringify({
        account_id: 'acc-1',
        worker_id: 'worker-1',
        message_id: 'wa-1',
        internal_message_id: 'internal-message-1',
        patch: {
          is_sent: true,
          is_delivered: true,
          is_seen: true,
        },
        failed: false,
        applied_at: Date.now(),
      })
    );

    await expect(
      service.isApplied({
        ...makeStatusUpdate({}),
        failed: true,
      })
    ).resolves.toBe(true);
  });

  it('does not let a sent acknowledgement hide a later definitive failure', async () => {
    const { redis, service } = makeService();
    redis.get.mockResolvedValue(
      JSON.stringify({
        account_id: 'acc-1',
        worker_id: 'worker-1',
        message_id: 'wa-1',
        internal_message_id: 'internal-message-1',
        patch: { is_sent: true },
        failed: false,
        applied_at: Date.now(),
      })
    );

    await expect(
      service.isApplied({
        ...makeStatusUpdate({}),
        failed: true,
      })
    ).resolves.toBe(false);
  });

  it('rejects markApplied from a claimant whose Redis lease is no longer owned', async () => {
    const { redis, service } = makeService();
    redis.eval.mockResolvedValue(0);
    const claim = JSON.stringify({
      owner_id: 'service-pod-a',
      token: 'claim-token-a',
    });

    await expect(
      service.markApplied(
        {
          ...makeStatusUpdate({ is_delivered: true }),
          pending_retry_version: 'retry-v1',
          pending_claim_owner: 'service-pod-a',
          pending_claim_token: claim,
        },
        'internal-message-1'
      )
    ).rejects.toMatchObject({
      name: 'MessageStatusPendingClaimLeaseLostError',
    });

    const script = redis.eval.mock.calls[0][0] as string;
    expect(script).toContain("redis.call('ZSCORE', KEYS[6]");
    expect(script).toContain('processing_score <= now');
    expect(script).toContain(
      "tostring(pending.pending_retry_version or '') ~= ARGV[13]"
    );
    expect(redis.eval.mock.calls[0].slice(-3)).toEqual([
      claim,
      'retry-v1',
      '0',
    ]);
  });

  it('isolates aliases for equal WhatsApp ids on different workers', async () => {
    const { redis, service } = makeService();

    await service.setInternalMessageIdAlias(
      'acc-1',
      'wa-1',
      'internal-1',
      'worker-1'
    );
    await service.setInternalMessageIdAlias(
      'acc-1',
      'wa-1',
      'internal-2',
      'worker-2'
    );

    expect(redis.setex.mock.calls.map(([key]) => key)).toEqual([
      'message-status:update:alias:acc-1:worker-1:wa-1',
      'message-status:update:alias:acc-1:worker-2:wa-1',
    ]);
  });

  it('deletes only the isolated legacy namespace without touching active v2 keys', async () => {
    const { redis, service } = makeService();
    redis.del.mockResolvedValue(5);

    await expect(service.discardLegacyPendingStatuses()).resolves.toBe(5);

    expect(redis.del).toHaveBeenCalledWith(
      'message-status:update:pending:retry',
      'message-status:update:pending:payloads',
      'message-status:update:pending:parking',
      'message-status:update:pending:processing',
      'message-status:update:pending:claims:v2'
    );
    expect(redis.del.mock.calls[0]).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('message-status:update:pending:v2:'),
      ])
    );
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('propagates a Redis failure while discarding the legacy namespace', async () => {
    const { redis, service } = makeService();
    redis.del.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.discardLegacyPendingStatuses()).rejects.toThrow(
      'redis unavailable'
    );
  });

  it('keeps all active operations inside the v2 redrive namespace', async () => {
    const { redis, service } = makeService();

    await service.deferMissingStatusUpdate(
      makeStatusUpdate(),
      { is_sent: true },
      { batchSize: 1, duration: 1 }
    );

    const keys = redis.eval.mock.calls[0].slice(2, 7);
    expect(keys).toEqual([
      'message-status:update:pending:v2:payloads',
      'message-status:update:pending:v2:retry',
      'message-status:update:pending:v2:parking',
      'message-status:update:pending:v2:processing',
      'message-status:update:pending:v2:claims',
    ]);
    expect(keys).not.toEqual(
      expect.arrayContaining([
        'message-status:update:pending:payloads',
        'message-status:update:pending:retry',
      ])
    );
  });

  it('only claims due retries owned by a locally active assignment', async () => {
    const { redis, service } = makeService();
    const owned = {
      ...makeStatusUpdate(),
      consumer_assignment_owner: 'consumer-pod-a',
      consumer_assignment_epoch: 7,
      consumer_partition: 2,
      pending_retry_version: 'retry-v1',
    };
    const foreign = {
      ...owned,
      message_id: 'wa-foreign',
      consumer_partition: 3,
      pending_retry_version: 'retry-v2',
    };
    redis.zscan.mockImplementation(async (key: string) =>
      key === 'message-status:update:pending:v2:retry'
        ? ['0', ['acc-1:worker-1:wa-1', '1', 'acc-1:worker-1:wa-foreign', '1']]
        : ['0', []]
    );
    redis.hget.mockImplementation(async (_key: string, member: string) =>
      JSON.stringify(member.endsWith('wa-foreign') ? foreign : owned)
    );

    const claimed = await service.claimDuePendingStatuses({
      ownerId: 'service-pod-a',
      decideClaim: (payload) =>
        payload.consumer_partition === 2 ? 'claim' : 'ignore',
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toEqual(
      expect.objectContaining({
        message_id: 'wa-1',
        pending_claim_owner: 'service-pod-a',
        pending_claim_token: expect.stringContaining('service-pod-a'),
      })
    );
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining("redis.call('TIME')")
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining('due_score > now')
    );
    expect(redis.eval.mock.calls[0].at(-1)).toBe(String(5 * 60_000));
    expect(redis.zscan).toHaveBeenCalledWith(
      'message-status:update:pending:v2:retry',
      '0',
      'COUNT',
      400
    );
  });

  it('sweeps obsolete parking and expired processing only for locally owned partitions', async () => {
    const { redis, service } = makeService();
    const payloads: Record<string, IMessageStatusUpdate> = {
      'owned-processing': {
        ...makeStatusUpdate(),
        message_id: 'owned-processing',
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 2,
        pending_retry_version: 'processing-v1',
      },
      'foreign-processing': {
        ...makeStatusUpdate(),
        message_id: 'foreign-processing',
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 3,
        pending_retry_version: 'processing-v2',
      },
      'owned-parking': {
        ...makeStatusUpdate(),
        message_id: 'owned-parking',
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 2,
        pending_retry_version: 'parking-v1',
        parked_at: 1,
      },
      'foreign-parking': {
        ...makeStatusUpdate(),
        message_id: 'foreign-parking',
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 3,
        pending_retry_version: 'parking-v2',
        parked_at: 1,
      },
      'active-parking': {
        ...makeStatusUpdate(),
        message_id: 'active-parking',
        consumer_assignment_owner: 'consumer-pod-a',
        consumer_assignment_epoch: 7,
        consumer_partition: 2,
        pending_retry_version: 'parking-v3',
        parked_at: 1,
      },
    };
    redis.zscan.mockImplementation(async (key: string) => {
      if (key === 'message-status:update:pending:v2:processing') {
        return ['0', ['owned-processing', '1', 'foreign-processing', '1']];
      }
      if (key === 'message-status:update:pending:v2:parking') {
        return [
          '0',
          ['owned-parking', '1', 'foreign-parking', '1', 'active-parking', '1'],
        ];
      }
      return ['0', []];
    });
    redis.hget.mockImplementation(async (_key: string, member: string) =>
      payloads[member] ? JSON.stringify(payloads[member]) : null
    );

    await expect(
      service.claimDuePendingStatuses({
        ownerId: 'service-pod-a',
        decideClaim: (payload) => {
          if (payload.consumer_partition !== 2) return 'ignore';
          return payload.consumer_assignment_owner === 'consumer-pod-a' &&
            payload.consumer_assignment_epoch === 7
            ? 'claim'
            : 'discard';
        },
      })
    ).resolves.toEqual([]);

    expect(redis.eval.mock.calls.map((call) => call[7])).toEqual([
      'owned-processing',
      'owned-parking',
    ]);
    expect(redis.eval.mock.calls.flat()).not.toContain('foreign-processing');
    expect(redis.eval.mock.calls.flat()).not.toContain('foreign-parking');
    expect(redis.eval.mock.calls.flat()).not.toContain('active-parking');
  });

  it('recovers an expired processing claim and reclaims it only for the active assignment', async () => {
    const { redis, service } = makeService();
    const payload = {
      ...makeStatusUpdate(),
      consumer_assignment_owner: 'consumer-pod-a',
      consumer_assignment_epoch: 7,
      consumer_partition: 2,
      pending_retry_version: 'processing-v1',
    };
    redis.zscan.mockImplementation(async (key: string) =>
      key === 'message-status:update:pending:v2:processing'
        ? ['0', ['acc-1:worker-1:wa-1', '1']]
        : ['0', []]
    );
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    const claimed = await service.claimDuePendingStatuses({
      ownerId: 'service-pod-a',
      decideClaim: () => 'claim',
    });

    expect(claimed).toHaveLength(1);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0].slice(1, 7)).toEqual([
      5,
      'message-status:update:pending:v2:processing',
      'message-status:update:pending:v2:retry',
      'message-status:update:pending:v2:parking',
      'message-status:update:pending:v2:claims',
      'message-status:update:pending:v2:payloads',
    ]);
    expect(redis.eval.mock.calls[1].slice(1, 7)).toEqual([
      5,
      'message-status:update:pending:v2:payloads',
      'message-status:update:pending:v2:retry',
      'message-status:update:pending:v2:parking',
      'message-status:update:pending:v2:processing',
      'message-status:update:pending:v2:claims',
    ]);
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining("redis.call('TIME')")
    );
    expect(redis.eval.mock.calls[0]).toHaveLength(9);
    expect(redis.eval.mock.calls[0].at(-1)).toBe(JSON.stringify(payload));
  });

  it('uses Redis time instead of a skewed pod clock to select due claims', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(9_000_000_000_000);
    const { redis, service } = makeService();
    redis.time.mockResolvedValue(['1', '0']);
    redis.zscan.mockImplementation(async (key: string) =>
      key === 'message-status:update:pending:v2:processing' ||
      key === 'message-status:update:pending:v2:retry'
        ? ['0', ['acc-1:worker-1:wa-1', '2000']]
        : ['0', []]
    );
    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate(),
        pending_retry_version: 'retry-v1',
      })
    );

    await expect(service.claimDuePendingStatuses()).resolves.toEqual([]);

    expect(redis.time).toHaveBeenCalledTimes(1);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('renews an owned processing claim while its handler remains blocked beyond the original lease', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const { redis, service } = makeService();
    const claim = {
      owner_id: 'service-pod-a',
      token: 'claim-token-a',
    };
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate(),
      consumer_assignment_owner: 'consumer-pod-a',
      consumer_assignment_epoch: 7,
      consumer_partition: 2,
      pending_retry_version: 'processing-v1',
      pending_claim_owner: claim.owner_id,
      pending_claim_token: JSON.stringify(claim),
    };
    let releaseHandler!: () => void;
    const blockedHandler = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const processing = service.withClaimHeartbeat(data, async () => {
      await blockedHandler;
    });
    await Promise.resolve();

    for (let heartbeat = 0; heartbeat < 3; heartbeat += 1) {
      await jest.advanceTimersByTimeAsync(100_000);
    }

    expect(redis.eval).toHaveBeenCalledTimes(4);
    for (const call of redis.eval.mock.calls) {
      expect(call.slice(1, 9)).toEqual([
        3,
        'message-status:update:pending:v2:payloads',
        'message-status:update:pending:v2:claims',
        'message-status:update:pending:v2:processing',
        'acc-1:worker-1:wa-1',
        'processing-v1',
        'service-pod-a',
        'claim-token-a',
      ]);
      expect(call.slice(9)).toEqual([String(5 * 60_000)]);
    }
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining('payload.pending_retry_version')
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining('claim.owner_id')
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining('claim.token')
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining("redis.call('TIME')")
    );
    expect(redis.eval.mock.calls[0][0]).toEqual(
      expect.stringContaining('now + processing_timeout')
    );

    releaseHandler();
    await processing;
  });

  it('does not inherit retry exhaustion or parking from an older pending status', async () => {
    const { redis, service } = makeService();
    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate({ is_delivered: true }),
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 2,
        retry_count: 99,
        first_seen_at: 1,
        parked_at: 2,
        pending_retry_version: 'parking-old',
      })
    );

    await service.deferMissingStatusUpdate(
      {
        ...makeStatusUpdate({ is_seen: true }),
        consumer_assignment_owner: 'consumer-pod-a',
        consumer_assignment_epoch: 7,
        consumer_partition: 2,
      },
      { is_seen: true },
      { batchSize: 1, duration: 1 }
    );

    const storedPayload = JSON.parse(redis.eval.mock.calls[0][9]);
    expect(storedPayload.retry_count).toBe(1);
    expect(storedPayload.first_seen_at).toBe(1000);
    expect(storedPayload.parked_at).toBeUndefined();
    expect(redis.eval.mock.calls[0][11]).toBe('0');
  });

  it('does not merge a stale owner patch into a fresh assignment event', async () => {
    const { redis, service } = makeService();
    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate({ is_seen: true }),
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: 2,
        retry_count: 99,
        parked_at: 2,
        pending_retry_version: 'parking-old',
      })
    );

    await service.deferMissingStatusUpdate(
      {
        ...makeStatusUpdate({ is_sent: true }),
        consumer_assignment_owner: 'consumer-pod-new',
        consumer_assignment_epoch: 7,
        consumer_partition: 2,
      },
      { is_sent: true },
      { batchSize: 1, duration: 1 }
    );

    const storedPayload = JSON.parse(redis.eval.mock.calls[0][9]);
    expect(storedPayload.patch).toEqual({ is_sent: true });
    expect(storedPayload.retry_count).toBe(1);
    expect(storedPayload.parked_at).toBeUndefined();
  });

  it('does not let a stale claimant delete a newer retry version', async () => {
    const { redis, service } = makeService();
    redis.hget.mockResolvedValue(
      JSON.stringify({
        ...makeStatusUpdate(),
        consumer_assignment_owner: 'consumer-pod-b',
        consumer_assignment_epoch: 9,
        consumer_partition: 2,
        pending_retry_version: 'new-version',
      })
    );

    await expect(
      service.discardClaimedPendingStatus({
        ...makeStatusUpdate(),
        consumer_assignment_owner: 'consumer-pod-a',
        consumer_assignment_epoch: 7,
        consumer_partition: 2,
        pending_retry_version: 'old-version',
        pending_claim_token: 'old-token',
      })
    ).resolves.toBe(false);

    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('fails closed when a claimed reschedule no longer owns its processing lease', async () => {
    const { redis, service } = makeService();
    const claim = JSON.stringify({
      owner_id: 'service-pod-a',
      token: 'claim-token-a',
    });
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_delivered: true }),
      pending_retry_version: 'retry-v1',
      pending_claim_owner: 'service-pod-a',
      pending_claim_token: claim,
    };
    redis.hget.mockResolvedValue(JSON.stringify(data));
    redis.eval.mockResolvedValue(0);

    await expect(
      service.reschedulePendingStatus(
        data,
        { batchSize: 1, duration: 10 },
        { incrementRetry: false }
      )
    ).rejects.toMatchObject({
      name: 'MessageStatusPendingClaimLeaseLostError',
    });

    const script = redis.eval.mock.calls[0][0] as string;
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('ZSCORE', KEYS[4]");
    expect(script).toContain('processing_score <= now');
  });

  it('CAS-discards a foreign retry only when the caller owns its partition', async () => {
    const { redis, service } = makeService();
    const foreign = {
      ...makeStatusUpdate(),
      consumer_assignment_owner: 'consumer-pod-a',
      consumer_assignment_epoch: 7,
      consumer_partition: 2,
      pending_retry_version: 'retry-v1',
    };
    const ignored = {
      ...foreign,
      message_id: 'wa-ignored',
      consumer_partition: 3,
      pending_retry_version: 'retry-v2',
    };
    redis.zscan.mockImplementation(async (key: string) =>
      key === 'message-status:update:pending:v2:retry'
        ? ['0', ['acc-1:worker-1:wa-1', '1', 'acc-1:worker-1:wa-ignored', '1']]
        : ['0', []]
    );
    redis.hget.mockImplementation(async (_key: string, member: string) =>
      JSON.stringify(member.endsWith('wa-ignored') ? ignored : foreign)
    );

    await expect(
      service.claimDuePendingStatuses({
        ownerId: 'service-pod-b',
        decideClaim: (payload) =>
          payload.consumer_partition === 2 ? 'discard' : 'ignore',
      })
    ).resolves.toEqual([]);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      5,
      'message-status:update:pending:v2:payloads',
      'message-status:update:pending:v2:retry',
      'message-status:update:pending:v2:parking',
      'message-status:update:pending:v2:processing',
      'message-status:update:pending:v2:claims',
      'acc-1:worker-1:wa-1',
      JSON.stringify(foreign),
      ''
    );
  });

  it('removes malformed retry entries without starving a valid retry behind them', async () => {
    const { redis, service } = makeService();
    const invalidMembers = Array.from(
      { length: 400 },
      (_, index) => `invalid-${index}`
    );
    const validMember = 'acc-1:worker-1:wa-valid';
    redis.zscan.mockImplementation(async (key: string, cursor: string) => {
      if (key !== 'message-status:update:pending:v2:retry') {
        return ['0', []];
      }
      return cursor === '0'
        ? ['retry-next', invalidMembers.flatMap((member) => [member, '1'])]
        : ['0', [validMember, '1']];
    });
    redis.hget.mockImplementation(async (_key: string, member: string) => {
      if (member !== validMember) {
        return null;
      }
      return JSON.stringify({
        ...makeStatusUpdate(),
        message_id: 'wa-valid',
        consumer_assignment_owner: 'consumer-pod-a',
        consumer_assignment_epoch: 7,
        consumer_partition: 2,
        pending_retry_version: 'valid-version',
      });
    });

    const firstClaim = await service.claimDuePendingStatuses({
      ownerId: 'service-pod-a',
      decideClaim: () => 'claim',
    });
    const claimed = await service.claimDuePendingStatuses({
      ownerId: 'service-pod-a',
      decideClaim: () => 'claim',
    });

    expect(firstClaim).toEqual([]);
    expect(claimed).toEqual([
      expect.objectContaining({ message_id: 'wa-valid' }),
    ]);
    expect(redis.eval).toHaveBeenCalledTimes(401);
    expect(redis.eval.mock.calls.flat()).toContain(validMember);
  });

  it('advances past a full page owned by other assignments without starving later retries', async () => {
    const { redis, service } = makeService();
    const ignoredMembers = Array.from(
      { length: 400 },
      (_, index) => `ignored-${index}`
    );
    const validMember = 'acc-1:worker-1:wa-valid';
    redis.zscan.mockImplementation(async (key: string, cursor: string) => {
      if (key !== 'message-status:update:pending:v2:retry') {
        return ['0', []];
      }
      return cursor === '0'
        ? ['retry-next', ignoredMembers.flatMap((member) => [member, '1'])]
        : ['0', [validMember, '1']];
    });
    redis.hget.mockImplementation(async (_key: string, member: string) =>
      JSON.stringify({
        ...makeStatusUpdate(),
        message_id: member,
        consumer_assignment_owner: 'consumer-pod-old',
        consumer_assignment_epoch: 6,
        consumer_partition: member === validMember ? 2 : 3,
        pending_retry_version: `version-${member}`,
      })
    );
    const decideClaim = (payload: IMessageStatusUpdate) =>
      payload.consumer_partition === 2
        ? ('claim' as const)
        : ('ignore' as const);

    await expect(
      service.claimDuePendingStatuses({
        ownerId: 'service-pod-a',
        decideClaim,
      })
    ).resolves.toEqual([]);
    await expect(
      service.claimDuePendingStatuses({
        ownerId: 'service-pod-a',
        decideClaim,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        message_id: validMember,
        pending_claim_owner: 'service-pod-a',
      }),
    ]);

    expect(redis.zscan).toHaveBeenCalledWith(
      'message-status:update:pending:v2:retry',
      'retry-next',
      'COUNT',
      400
    );
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });
});
