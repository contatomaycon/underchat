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

jest.mock('@core/common/functions/startHeartbeat', () => ({
  startHeartbeat: jest.fn(() => jest.fn()),
}));

jest.mock('@whiskeysockets/baileys', () => ({}));

import { MessageUpdateConsume } from '@core/consumer/message/MessageUpdate.consume';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';

describe('MessageUpdateConsume', () => {
  it('stores alias and requeues pending ACKs after message_key.id is applied', async () => {
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
      publishPendingStatus: jest.fn().mockResolvedValue(undefined),
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
    expect(
      messageStatusPendingService.publishPendingStatus
    ).toHaveBeenCalledWith('acc-1', '3EB123');
  });
});
