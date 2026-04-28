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

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';

describe('MessageStatusPendingService', () => {
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
    const kafkaServiceQueueService = {
      updateMessageStatus: jest.fn().mockReturnValue('update.message.status'),
    };
    const streamProducerService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const service = new MessageStatusPendingService(
      redis as never,
      kafkaServiceQueueService as never,
      streamProducerService as never
    );

    return {
      kafkaServiceQueueService,
      redis,
      service,
      streamProducerService,
    };
  };

  const makeStatusUpdate = (
    patch: IMessageStatusUpdate['patch'] = { is_sent: true }
  ): IMessageStatusUpdate => ({
    account_id: 'acc-1',
    message_id: 'wa-1',
    patch,
    retry_count: 20,
    first_seen_at: 1000,
  });

  it('stores pending status updates with a stable account/message key and never discards exhausted retries', async () => {
    const { redis, service } = makeService();

    redis.hget.mockResolvedValue(
      JSON.stringify(makeStatusUpdate({ is_delivered: true }))
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
    expect(payload.retry_count).toBe(21);
    expect(payload.patch).toEqual({
      is_delivered: true,
      is_seen: true,
      is_sent: true,
    });
  });

  it('requeues a pending status using the same stable key', async () => {
    const { redis, service, streamProducerService } = makeService();
    const payload = makeStatusUpdate({ is_delivered: true });
    redis.hget.mockResolvedValue(JSON.stringify(payload));

    await service.publishPendingStatus('acc-1', 'wa-1');

    expect(redis.zrem).toHaveBeenCalledWith(
      'message-status:update:pending:retry',
      'acc-1:wa-1'
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      payload,
      'acc-1:wa-1'
    );
    expect(redis.hdel).toHaveBeenCalledWith(
      'message-status:update:pending:payloads',
      'acc-1:wa-1'
    );
  });
});
