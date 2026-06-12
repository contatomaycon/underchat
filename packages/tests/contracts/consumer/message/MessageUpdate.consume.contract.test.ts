import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/messageStatusPending.service', () => ({
  MessageStatusPendingService: class MessageStatusPendingService {},
}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@whiskeysockets/baileys', () => ({}));

import { MessageUpdateConsume } from '@core/consumer/message/MessageUpdate.consume';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { commitOffset } from '@core/common/functions/commitOffset';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('MessageUpdateConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores alias and wakes pending ACKs after message_key.id is applied', async () => {
    const redis = {
      del: jest.fn().mockResolvedValue(1),
    };
    const kafkaServiceQueueService = {
      updateMessage: jest.fn().mockReturnValue('update.message'),
      getNumPartitions: jest.fn().mockReturnValue(1),
      getReplicationFactor: jest.fn().mockReturnValue(1),
    };
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn().mockResolvedValue('updated'),
    };
    const messageStatusPendingService = {
      setInternalMessageIdAlias: jest.fn().mockResolvedValue(undefined),
      wakePendingStatus: jest.fn().mockResolvedValue(true),
    };
    const consumer = new MessageUpdateConsume(
      redis as never,
      {} as never,
      kafkaServiceQueueService as never,
      elasticDatabaseService as never,
      messageStatusPendingService as never
    );
    const data: IUpdateMessage = {
      data: {
        account: { id: 'acc-1' },
        chat_id: 'chat-1',
        message_id: 'internal-1',
      },
      message: {
        key: {
          id: 'true_5511999999999@s.whatsapp.net_3EB123',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
      },
    } as IUpdateMessage;

    await (consumer as any).handleMessage(data);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      'internal-1',
      expect.objectContaining({
        params: expect.objectContaining({
          patch: expect.objectContaining({ id: '3EB123' }),
        }),
      }),
      { maxRetries: 5 }
    );
    expect(
      messageStatusPendingService.setInternalMessageIdAlias
    ).toHaveBeenCalledWith('acc-1', '3EB123', 'internal-1');
    expect(messageStatusPendingService.wakePendingStatus).toHaveBeenCalledWith(
      'acc-1',
      '3EB123'
    );
  });

  it('logs update failures and lets the runner commit the offset', async () => {
    const handlers: Record<string, (...args: any[]) => unknown> = {};
    const kafkaConsumer: {
      on: jest.Mock;
      commit: jest.Mock;
      unsubscribe: jest.Mock;
      disconnect: jest.Mock;
    } = {
      on: jest.fn(),
      commit: jest.fn(),
      unsubscribe: jest.fn(),
      disconnect: jest.fn(),
    };
    kafkaConsumer.on.mockImplementation(
      (event: string, handler: (...args: any[]) => unknown) => {
        handlers[event] = handler;
        return kafkaConsumer;
      }
    );
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);
    (connectConsumer as jest.Mock).mockImplementation((_consumer, _topic, cb) =>
      cb()
    );
    (ensureKafkaTopic as jest.Mock).mockResolvedValue(undefined);
    (commitOffset as jest.Mock).mockResolvedValue(undefined);

    const redis = {
      del: jest.fn().mockResolvedValue(1),
    };
    const kafkaServiceQueueService = {
      updateMessage: jest.fn().mockReturnValue('update.message'),
      getNumPartitions: jest.fn().mockReturnValue(1),
      getReplicationFactor: jest.fn().mockReturnValue(1),
    };
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn().mockRejectedValue(new Error('es timeout')),
    };
    const messageStatusPendingService = {
      setInternalMessageIdAlias: jest.fn().mockResolvedValue(undefined),
      wakePendingStatus: jest.fn().mockResolvedValue(true),
    };
    const consumer = new MessageUpdateConsume(
      redis as never,
      {} as never,
      kafkaServiceQueueService as never,
      elasticDatabaseService as never,
      messageStatusPendingService as never
    );
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await consumer.execute();
      const data: IUpdateMessage = {
        data: {
          account: { id: 'acc-1' },
          chat_id: 'chat-1',
          message_id: 'internal-1',
        },
        message: {
          key: {
            id: '3EB123',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
          },
        },
      } as IUpdateMessage;

      handlers.data?.({
        value: Buffer.from(JSON.stringify(data)),
        partition: 3,
        offset: 41,
      });
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageUpdateConsume] message update failed',
        expect.objectContaining({
          topic: 'update.message',
          partition: 3,
          offset: 41,
          error: expect.any(Error),
        })
      );
      expect(commitOffset).toHaveBeenCalledWith(
        kafkaConsumer,
        'update.message',
        3,
        41
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
