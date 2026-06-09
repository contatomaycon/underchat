import 'reflect-metadata';

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@core/plugins/telemetry/observability', () => ({
  incrementCounter: jest.fn(),
}));

import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import { logger } from '@core/plugins/telemetry/logger';
import { incrementCounter } from '@core/plugins/telemetry/observability';

describe('MessageStatusPendingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeService = () => {
    const redis = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      hget: jest.fn().mockResolvedValue(null),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      zadd: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue(null),
      zrangebyscore: jest.fn().mockResolvedValue([]),
      zrem: jest.fn().mockResolvedValue(1),
    };

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
    message_id: 'wa-1',
    patch,
    retry_count: 0,
    first_seen_at: 1000,
  });

  it('stores pending status updates with a stable account/message key and merges patches', async () => {
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

    expect(redis.hset).toHaveBeenCalledWith(
      'message-status:update:pending:payloads',
      'acc-1:wa-1',
      expect.any(String)
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      'message-status:update:pending:retry',
      expect.any(Number),
      'acc-1:wa-1'
    );
    expect(redis.hdel).not.toHaveBeenCalled();

    const payload = JSON.parse(redis.hset.mock.calls[0][2]);
    expect(payload.retry_count).toBe(2);
    expect(payload.patch).toEqual({
      is_delivered: true,
      is_seen: true,
      is_sent: true,
    });
  });

  it('wakes a pending status using the same stable key without publishing to Kafka', async () => {
    const { redis, service } = makeService();
    const payload = makeStatusUpdate({ is_delivered: true });
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    await service.wakePendingStatus('acc-1', 'wa-1');

    expect(redis.zrem).toHaveBeenCalledWith(
      'message-status:update:pending:parking',
      'acc-1:wa-1'
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      'message-status:update:pending:retry',
      expect.any(Number),
      'acc-1:wa-1'
    );
    expect(redis.hdel).not.toHaveBeenCalled();
  });

  it('resets retry count when waking a parked status', async () => {
    const { redis, service } = makeService();
    const payload = {
      ...makeStatusUpdate({ is_delivered: true }),
      retry_count: 99,
      parked_at: 123,
    };
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    await service.wakePendingStatus('acc-1', 'wa-1');

    expect(redis.hset).toHaveBeenCalledWith(
      'message-status:update:pending:payloads',
      'acc-1:wa-1',
      expect.any(String)
    );
    const wakePayload = JSON.parse(redis.hset.mock.calls[0][2]);
    expect(wakePayload.retry_count).toBe(0);
    expect(wakePayload.parked_at).toBe(123);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        retry_count: 0,
        type: 'message_status_pending_woken',
      }),
      expect.any(String)
    );
  });

  it('marks applied status updates and clears retry plus parking state', async () => {
    const { redis, service } = makeService();

    await service.markApplied(
      makeStatusUpdate({ is_seen: true }),
      'internal-1'
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'message-status:update:applied:acc-1:wa-1',
      expect.any(Number),
      expect.any(String)
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'message-status:update:alias:acc-1:wa-1',
      expect.any(Number),
      'internal-1'
    );
    expect(redis.hdel).toHaveBeenCalledWith(
      'message-status:update:pending:payloads',
      'acc-1:wa-1'
    );
    expect(redis.zrem).toHaveBeenCalledWith(
      'message-status:update:pending:retry',
      'acc-1:wa-1'
    );
    expect(redis.zrem).toHaveBeenCalledWith(
      'message-status:update:pending:parking',
      'acc-1:wa-1'
    );

    const ledgerPayload = JSON.parse(redis.setex.mock.calls[0][2]);
    expect(ledgerPayload.patch).toEqual({
      is_delivered: true,
      is_seen: true,
      is_sent: true,
    });
  });

  it('treats weaker status updates as already applied when the ledger is stronger', async () => {
    const { redis, service } = makeService();
    redis.get.mockResolvedValue(
      JSON.stringify({
        account_id: 'acc-1',
        message_id: 'wa-1',
        internal_message_id: 'internal-1',
        patch: {
          is_sent: true,
          is_delivered: true,
          is_seen: true,
        },
        applied_at: 123,
      })
    );

    await expect(
      service.isApplied(makeStatusUpdate({ is_delivered: true }))
    ).resolves.toBe(true);
  });

  it('parks exhausted retries without discarding the pending payload', async () => {
    const { redis, service } = makeService();
    const payload = {
      ...makeStatusUpdate({ is_seen: true }),
      retry_count: 8,
    };

    await service.deferMissingStatusUpdate(payload, payload.patch, {
      batchSize: 1,
      duration: 50,
    });

    expect(redis.hset).toHaveBeenLastCalledWith(
      'message-status:update:pending:payloads',
      'acc-1:wa-1',
      expect.any(String)
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      'message-status:update:pending:parking',
      expect.any(Number),
      'acc-1:wa-1'
    );
    const parkedPayload = JSON.parse(
      redis.hset.mock.calls[redis.hset.mock.calls.length - 1][2]
    );
    expect(parkedPayload.parked_at).toEqual(expect.any(Number));
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message_status_pending_parking_lot',
      }),
      expect.any(String)
    );
  });

  it('does not emit another parking error for an already parked status', async () => {
    const { redis, service } = makeService();
    const payload = {
      ...makeStatusUpdate({ is_seen: true }),
      retry_count: 10,
      parked_at: 123,
    };
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    await service.deferMissingStatusUpdate(payload, payload.patch, {
      batchSize: 1,
      duration: 50,
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(incrementCounter).not.toHaveBeenCalledWith(
      'message_status_update_pending_parking_lot',
      expect.any(Number),
      expect.any(Object)
    );
  });
});
