import 'reflect-metadata';

import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';

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

    const payload = JSON.parse(redis.hset.mock.calls[0][2]);
    expect(payload.retry_count).toBe(2);
    expect(payload.patch).toEqual({
      is_delivered: true,
      is_seen: true,
      is_sent: true,
    });
  });

  it('wakes a pending status using the same stable key', async () => {
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

    expect(redis.zadd).toHaveBeenCalledWith(
      'message-status:update:pending:parking',
      expect.any(Number),
      'acc-1:wa-1'
    );
    const parkedPayload = JSON.parse(
      redis.hset.mock.calls[redis.hset.mock.calls.length - 1][2]
    );
    expect(parkedPayload.parked_at).toEqual(expect.any(Number));
  });
});
