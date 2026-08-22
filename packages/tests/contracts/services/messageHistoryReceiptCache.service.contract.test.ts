import Redis from 'ioredis';
import {
  MessageHistoryReceiptCacheService,
  MessageHistoryReceiptIdentityError,
} from '@core/services/messageHistoryReceiptCache.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';

function historyEvent(overrides: Partial<IUpsertMessage> = {}): IUpsertMessage {
  return {
    account_id: 'account-1',
    worker_id: 'worker-1',
    event_id: 'waevt_v1_physical-event',
    ...overrides,
  } as IUpsertMessage;
}

function emptyReceiptRedis() {
  const redis = {
    hget: jest.fn(async (): Promise<string | null> => null),
    exists: jest.fn(async () => 0),
    sismember: jest.fn(async () => 0),
    eval: jest.fn(async (script: string): Promise<unknown> => {
      if (script.includes('message_history_receipt_reserve_v3')) {
        return ['acquired', 'reserved'];
      }
      if (script.includes('message_history_receipt_extend_v3')) {
        return Date.now() + 120_000;
      }
      if (script.includes('message_history_receipt_transition_v3')) {
        return 'transitioned';
      }
      if (script.includes('message_history_receipt_mark_known_v3')) {
        return 1;
      }
      throw new Error('unexpected Redis script');
    }),
  };
  return redis;
}

function statefulReceiptRedis() {
  let nowMs = 10_000;
  let state: string | null = null;
  let owner: string | null = null;
  let leaseUntilMs = 0;
  const redis = {
    hget: jest.fn(async (_key: string, field: string) => {
      if (field === 'state') return state;
      if (field === 'owner') return owner;
      if (field === 'lease_until_ms') return String(leaseUntilMs);
      return null;
    }),
    exists: jest.fn(async () => (state ? 1 : 0)),
    sismember: jest.fn(async () => 0),
    eval: jest.fn(
      async (
        script: string,
        _keyCount: number,
        _key: string,
        ...args: string[]
      ) => {
        if (script.includes('message_history_receipt_reserve_v3')) {
          const nextOwner = args[0];
          const leaseMs = Number(args[2]);
          if (
            state === null ||
            (state === 'reserved' && leaseUntilMs <= nowMs)
          ) {
            state = 'reserved';
            owner = nextOwner;
            leaseUntilMs = nowMs + leaseMs;
            return ['acquired', 'reserved'];
          }
          return ['duplicate', state];
        }
        if (script.includes('message_history_receipt_extend_v3')) {
          if (
            (state !== 'reserved' && state !== 'publishing') ||
            owner !== args[0] ||
            (state === 'reserved' && leaseUntilMs <= nowMs)
          ) {
            return 0;
          }
          leaseUntilMs = nowMs + Number(args[1]);
          return leaseUntilMs;
        }
        if (script.includes('message_history_receipt_transition_v3')) {
          const transitionOwner = args[0];
          const expectedState = args[1];
          const targetState = args[2];
          if (state === null) return 'not_found';
          if (
            state === 'known' ||
            state === 'published' ||
            state === 'ambiguous'
          ) {
            return 'already_completed';
          }
          if (owner !== transitionOwner) return 'owner_mismatch';
          if (state === targetState) return 'already_completed';
          if (state !== expectedState) return 'invalid_state';
          if (
            expectedState === 'reserved' &&
            targetState === 'publishing' &&
            leaseUntilMs <= nowMs
          ) {
            return 'lease_expired';
          }
          state = targetState;
          if (targetState !== 'publishing') {
            owner = null;
            leaseUntilMs = 0;
          }
          return 'transitioned';
        }
        if (script.includes('message_history_receipt_mark_known_v3')) {
          state = 'known';
          owner = null;
          leaseUntilMs = 0;
          return 1;
        }
        throw new Error('unexpected Redis script');
      }
    ),
  };

  return {
    redis,
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    snapshot: () => ({ state, owner, leaseUntilMs }),
  };
}

describe('MessageHistoryReceiptCacheService durable receipt ownership', () => {
  it('atomically reserves the physical event for 30 days before publication', async () => {
    const redis = emptyReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis,
      {
        knownTtlSeconds: 2_592_000,
        inflightTtlSeconds: 120,
      }
    );

    const reservation = await service.reserveForHistory(historyEvent());

    expect(reservation.status).toBe('acquired');
    if (reservation.status !== 'acquired') {
      throw new Error('expected an acquired receipt reservation');
    }
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('message_history_receipt_reserve_v3'),
      1,
      'wa:received-msg:v2:event:account-1:worker-1:waevt_v1_physical-event',
      reservation.claim.owner,
      'waevt_v1_physical-event',
      '120000',
      '2592000'
    );
  });

  it('uses the same durable identity across providers', async () => {
    const redis = emptyReceiptRedis();
    redis.hget.mockResolvedValue('published');
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    await expect(
      service.reserveForHistory(historyEvent({ source_provider: 'wwebjs' }))
    ).resolves.toEqual({
      status: 'duplicate',
      state: 'published',
      eventId: 'waevt_v1_physical-event',
    });
    await expect(
      service.reserveForHistory(historyEvent({ source_provider: 'whatsmeow' }))
    ).resolves.toEqual({
      status: 'duplicate',
      state: 'published',
      eventId: 'waevt_v1_physical-event',
    });

    expect(redis.hget).toHaveBeenNthCalledWith(
      1,
      'wa:received-msg:v2:event:account-1:worker-1:waevt_v1_physical-event',
      'state'
    );
    expect(redis.hget).toHaveBeenNthCalledWith(
      2,
      'wa:received-msg:v2:event:account-1:worker-1:waevt_v1_physical-event',
      'state'
    );
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('lets only one pod acquire the atomic reservation', async () => {
    const redis = emptyReceiptRedis();
    redis.eval
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce(['duplicate', 'reserved']);
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    const first = await service.reserveForHistory(historyEvent());
    const second = await service.reserveForHistory(historyEvent());

    expect(first.status).toBe('acquired');
    expect(second).toEqual({
      status: 'duplicate',
      state: 'reserved',
      eventId: 'waevt_v1_physical-event',
    });
  });

  it('atomically takes over only an expired reserved lease and fences the old owner', async () => {
    const ledger = statefulReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      ledger.redis as unknown as Redis,
      { inflightTtlSeconds: 1 }
    );

    const first = await service.reserveForHistory(historyEvent());
    if (first.status !== 'acquired') {
      throw new Error('expected first owner to acquire');
    }

    await expect(service.reserveForHistory(historyEvent())).resolves.toEqual({
      status: 'duplicate',
      state: 'reserved',
      eventId: 'waevt_v1_physical-event',
    });

    ledger.advance(1_001);
    await expect(service.markPublishing(first.claim)).resolves.toBe(
      'lease_expired'
    );
    const takeover = await service.reserveForHistory(historyEvent());
    if (takeover.status !== 'acquired') {
      throw new Error('expected expired reservation takeover');
    }
    expect(takeover.claim.owner).not.toBe(first.claim.owner);
    await expect(service.markPublishing(first.claim)).resolves.toBe(
      'owner_mismatch'
    );
    await expect(service.markPublished(first.claim)).resolves.toBe(
      'owner_mismatch'
    );
    await expect(service.markKnownFromReservation(first.claim)).resolves.toBe(
      'owner_mismatch'
    );
    await expect(
      service.markAmbiguous(first.claim, new Error('stale owner'))
    ).resolves.toBe('owner_mismatch');
    await expect(service.markPublishing(takeover.claim)).resolves.toBe(
      'transitioned'
    );

    const reserveScript = ledger.redis.eval.mock.calls
      .map(([script]) => String(script))
      .find((script) => script.includes('message_history_receipt_reserve_v3'));
    expect(reserveScript).toContain('current_lease_ms <= now_ms');
    expect(reserveScript).toContain("state ~= 'publishing'");
  });

  it('never takes over publishing or terminal receipt states', async () => {
    const ledger = statefulReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      ledger.redis as unknown as Redis,
      { inflightTtlSeconds: 1 }
    );
    const reservation = await service.reserveForHistory(historyEvent());
    if (reservation.status !== 'acquired') {
      throw new Error('expected receipt reservation');
    }

    await expect(service.markPublishing(reservation.claim)).resolves.toBe(
      'transitioned'
    );
    ledger.advance(60_000);
    await expect(service.reserveForHistory(historyEvent())).resolves.toEqual({
      status: 'duplicate',
      state: 'publishing',
      eventId: 'waevt_v1_physical-event',
    });

    await expect(service.markPublished(reservation.claim)).resolves.toBe(
      'transitioned'
    );
    ledger.advance(60_000);
    await expect(service.reserveForHistory(historyEvent())).resolves.toEqual({
      status: 'duplicate',
      state: 'published',
      eventId: 'waevt_v1_physical-event',
    });
  });

  it('does not let a missing receipt be finalized by a stale owner', async () => {
    const redis = emptyReceiptRedis();
    redis.eval.mockResolvedValueOnce('not_found');
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    await expect(
      service.markPublishing({
        key: 'missing',
        owner: 'stale-owner',
        eventId: 'waevt_v1_physical-event',
        state: 'reserved',
      })
    ).resolves.toBe('not_found');

    expect(String(redis.eval.mock.calls[0][0])).toContain("return 'not_found'");
  });

  it('fails closed when Redis cannot determine whether an event is known', async () => {
    const redis = emptyReceiptRedis();
    redis.hget.mockRejectedValue(new Error('redis unavailable'));
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    await expect(service.isKnown(historyEvent())).rejects.toThrow(
      'redis unavailable'
    );
    await expect(service.reserveForHistory(historyEvent())).rejects.toThrow(
      'redis unavailable'
    );
  });

  it('fails closed when the durable known transition cannot be persisted', async () => {
    const redis = emptyReceiptRedis();
    redis.eval.mockRejectedValue(new Error('redis unavailable'));
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    await expect(service.markKnown(historyEvent())).rejects.toThrow(
      'redis unavailable'
    );
  });

  it('rejects a history event without a physical event identity', async () => {
    const redis = emptyReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );

    await expect(
      service.reserveForHistory(
        historyEvent({
          event_id: undefined,
          account_id: '',
        })
      )
    ).rejects.toBeInstanceOf(MessageHistoryReceiptIdentityError);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('renews only the owner lease while retaining the durable receipt', async () => {
    const redis = emptyReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis,
      { inflightTtlSeconds: 120 }
    );
    const reservation = await service.reserveForHistory(historyEvent());
    if (reservation.status !== 'acquired') {
      throw new Error('expected an acquired receipt reservation');
    }
    const callback = jest.fn(async (assertOwned: () => Promise<void>) => {
      await assertOwned();
      return 'processed';
    });

    await expect(
      service.withReservation(reservation.claim, callback)
    ).resolves.toBe('processed');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(
      redis.eval.mock.calls.filter(([script]) =>
        String(script).includes('message_history_receipt_extend_v3')
      )
    ).toHaveLength(2);
  });

  it('persists publication intent before allowing a terminal outcome', async () => {
    const redis = emptyReceiptRedis();
    const service = new MessageHistoryReceiptCacheService(
      redis as unknown as Redis
    );
    const reservation = await service.reserveForHistory(historyEvent());
    if (reservation.status !== 'acquired') {
      throw new Error('expected an acquired receipt reservation');
    }

    await expect(service.markPublishing(reservation.claim)).resolves.toBe(
      'transitioned'
    );
    await expect(
      service.markAmbiguous(reservation.claim, new Error('kafka ack timeout'))
    ).resolves.toBe('transitioned');

    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('message_history_receipt_transition_v3'),
      1,
      reservation.claim.key,
      reservation.claim.owner,
      'publishing',
      'ambiguous',
      '2592000',
      'kafka ack timeout'
    );
    expect(
      redis.eval.mock.calls.some(([script]) =>
        String(script).includes("redis.call('DEL'")
      )
    ).toBe(false);
  });
});
