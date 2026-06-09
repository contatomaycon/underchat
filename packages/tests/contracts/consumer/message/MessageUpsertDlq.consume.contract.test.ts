import 'reflect-metadata';
import { EventEmitter } from 'node:events';

const mockCreateOrUpdateChat = jest.fn();

jest.mock('@core/consumer/message/MessageUpsert.consume', () => ({
  MessageUpsertConsume: class MessageUpsertConsume {
    createOrUpdateChat = mockCreateOrUpdateChat;
  },
}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn((_consumer, _topic, onConnected) => onConnected?.()),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@core/common/functions/startHeartbeat', () => ({
  startHeartbeat: jest.fn(() => jest.fn()),
}));

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';
import { logger } from '@core/plugins/telemetry/logger';

const { MessageUpsertDlqConsume } =
  require('@core/consumer/message/MessageUpsertDlq.consume') as typeof import('@core/consumer/message/MessageUpsertDlq.consume');

class FakeConsumer extends EventEmitter {
  commit = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('MessageUpsertDlqConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits terminal DLQ payloads without logging them as processing errors', async () => {
    const kafkaConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const kafkaServiceQueueService = {
      upsertMessageDlq: jest.fn(() => 'upsert.message.dlq'),
      getNumPartitions: jest.fn(() => 30),
      getReplicationFactor: jest.fn(() => 3),
    };
    const consumer = new MessageUpsertDlqConsume(
      {} as never,
      kafkaServiceQueueService as never
    );

    try {
      await consumer.execute(jest.fn() as never);

      kafkaConsumer.emit('data', {
        value: Buffer.from(
          JSON.stringify({
            account_id: 'acc-1',
            worker_id: 'worker-1',
            message: {
              key: {
                id: 'call-1',
                remoteJid: 'status@broadcast',
              },
            },
            dlq_error: 'Received message without valid phone',
            dlq_timestamp: '2026-06-09T16:00:00.000Z',
          })
        ),
        partition: 7,
        offset: 41,
      });

      await flushPromises();
      await expect((consumer as any).partitionChains.get(7)).resolves.toBe(
        undefined
      );

      expect(mockCreateOrUpdateChat).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message_upsert_dlq_terminal_discarded',
          error: 'Received message without valid phone',
          account_id: 'acc-1',
          worker_id: 'worker-1',
          message_id: 'call-1',
        }),
        expect.any(String)
      );
      expect(commitOffset).toHaveBeenCalledWith(
        kafkaConsumer,
        'upsert.message.dlq',
        7,
        41
      );
    } finally {
      consoleSpy.mockRestore();
      await consumer.close();
    }
  });
});
