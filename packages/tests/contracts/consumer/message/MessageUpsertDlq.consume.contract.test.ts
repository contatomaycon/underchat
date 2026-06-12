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

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

const { MessageUpsertDlqConsume } =
  require('@core/consumer/message/MessageUpsertDlq.consume') as typeof import('@core/consumer/message/MessageUpsertDlq.consume');

class FakeConsumer extends EventEmitter {
  commit = jest.fn();
  pause = jest.fn();
  resume = jest.fn();
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
    mockCreateOrUpdateChat.mockReset();
  });

  it('commits terminal DLQ payloads without reprocessing them', async () => {
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

      expect(mockCreateOrUpdateChat).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
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

  it('deduplicates DLQ messages by account, worker, jid and message id', async () => {
    const kafkaConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);

    const kafkaServiceQueueService = {
      upsertMessageDlq: jest.fn(() => 'upsert.message.dlq'),
      getNumPartitions: jest.fn(() => 30),
      getReplicationFactor: jest.fn(() => 3),
    };
    const consumer = new MessageUpsertDlqConsume(
      {} as never,
      kafkaServiceQueueService as never
    );

    const payload = {
      account_id: 'acc-1',
      worker_id: 'worker-1',
      message: {
        key: {
          id: 'msg-1',
          remoteJid: '556999715039@s.whatsapp.net',
        },
      },
    };

    await consumer.execute(jest.fn() as never);

    kafkaConsumer.emit('data', {
      value: Buffer.from(JSON.stringify(payload)),
      key: Buffer.from('acc-1:worker-1:556999715039@s.whatsapp.net:msg-1'),
      partition: 3,
      offset: 20,
    });
    kafkaConsumer.emit('data', {
      value: Buffer.from(JSON.stringify(payload)),
      key: Buffer.from('acc-1:worker-1:556999715039@s.whatsapp.net:msg-1'),
      partition: 3,
      offset: 21,
    });

    await flushPromises();

    expect(mockCreateOrUpdateChat).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      kafkaConsumer,
      'upsert.message.dlq',
      3,
      20
    );
    expect(commitOffset).toHaveBeenCalledWith(
      kafkaConsumer,
      'upsert.message.dlq',
      3,
      21
    );

    await consumer.close();
  });

  it('discards DLQ processing failures after one attempt and commits the offset', async () => {
    const kafkaConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);
    mockCreateOrUpdateChat.mockRejectedValueOnce(new Error('db unavailable'));
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
                id: 'msg-2',
                remoteJid: '556999715039@s.whatsapp.net',
              },
            },
          })
        ),
        partition: 4,
        offset: 31,
      });

      await flushPromises();

      expect(mockCreateOrUpdateChat).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(commitOffset).toHaveBeenCalledWith(
        kafkaConsumer,
        'upsert.message.dlq',
        4,
        31
      );
    } finally {
      consoleSpy.mockRestore();
      await consumer.close();
    }
  });
});
