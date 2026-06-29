import 'reflect-metadata';

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

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

jest.mock('@core/services/messageStatusPending.service', () => ({
  MessageStatusPendingService: class MessageStatusPendingService {},
}));

jest.mock('@core/services/messageStatus.service', () => ({
  MessageStatusService: class MessageStatusService {
    static hashPatch(): string {
      return 'status-hash';
    }
  },
}));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import type { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';

const { MessageStatusUpdateConsume } =
  require('@core/consumer/message/MessageStatusUpdate.consume') as typeof import('@core/consumer/message/MessageStatusUpdate.consume');

describe('MessageStatusUpdateConsume', () => {
  const makeConsumer = () => {
    const redis = {
      exists: jest.fn().mockResolvedValue(0),
      hget: jest.fn().mockResolvedValue(null),
      hset: jest.fn().mockResolvedValue(1),
      setex: jest.fn().mockResolvedValue('OK'),
      zadd: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue(null),
    };
    const messageStatusService = {
      updateSummaryByWhatsAppId: jest.fn(),
    };
    const messageStatusPendingService = {
      deferMissingStatusUpdate: jest.fn().mockResolvedValue(undefined),
      claimDuePendingStatuses: jest.fn().mockResolvedValue([]),
      clearPendingStatus: jest.fn().mockResolvedValue(undefined),
      isApplied: jest.fn().mockResolvedValue(false),
      markApplied: jest.fn().mockResolvedValue(undefined),
      reschedulePendingStatus: jest.fn().mockResolvedValue(undefined),
      mergePatches: jest.fn((patches: IMessageStatusUpdate['patch'][]) => {
        const merged: IMessageStatusUpdate['patch'] = {};
        for (const patch of patches) {
          if (patch.is_seen) {
            merged.is_seen = true;
            merged.is_delivered = true;
            merged.is_sent = true;
          } else if (patch.is_delivered) {
            merged.is_delivered = true;
            merged.is_sent = true;
          } else if (patch.is_sent) {
            merged.is_sent = true;
          }
        }
        return merged;
      }),
    };
    const kafkaServiceQueueService = {
      updateMessageStatus: jest.fn().mockReturnValue('update.message.status'),
    };

    const consumer = new MessageStatusUpdateConsume(
      {} as never,
      kafkaServiceQueueService as never,
      messageStatusService as never,
      messageStatusPendingService as never,
      redis as never
    );

    return {
      consumer,
      kafkaServiceQueueService,
      redis,
      messageStatusService,
      messageStatusPendingService,
    };
  };

  const makeStatusUpdate = (
    patch: IMessageStatusUpdate['patch'] = { is_delivered: true }
  ): IMessageStatusUpdate => ({
    account_id: 'acc-1',
    message_id: 'msg-1',
    patch,
    key: {
      id: 'msg-1',
      fromMe: true,
      remoteJid: '5511999999999@s.whatsapp.net',
    },
  });

  it('defers a status update when the target message is not indexed yet', async () => {
    const {
      consumer,
      redis,
      messageStatusPendingService,
      messageStatusService,
    } = makeConsumer();
    const data = makeStatusUpdate();

    messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue(null);

    await (consumer as any).processStatusUpdate(data);

    expect(
      messageStatusPendingService.deferMissingStatusUpdate
    ).toHaveBeenCalledWith(
      {
        ...data,
        patch: { is_delivered: true, is_sent: true },
      },
      { is_delivered: true, is_sent: true },
      {
        batchSize: 1,
        duration: expect.any(Number),
      }
    );
    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('marks a status update as processed only after the message is updated', async () => {
    const {
      consumer,
      redis,
      messageStatusPendingService,
      messageStatusService,
    } = makeConsumer();
    const data = makeStatusUpdate({ is_seen: true });

    messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue({
      message_id: 'internal-message-id',
    });

    await (consumer as any).processStatusUpdate(data);

    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('status-update:acc-1:msg-1:'),
      86400,
      '1'
    );
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      {
        ...data,
        patch: {
          is_delivered: true,
          is_seen: true,
          is_sent: true,
        },
      },
      'internal-message-id'
    );
  });

  it('reconciles due pending statuses internally without publishing to Kafka', async () => {
    const {
      consumer,
      kafkaServiceQueueService,
      messageStatusPendingService,
      messageStatusService,
    } = makeConsumer();
    const data = makeStatusUpdate({ is_seen: true });

    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue({
      message_id: 'internal-message-id',
    });

    await (consumer as any).processDuePendingStatuses();

    expect(messageStatusService.updateSummaryByWhatsAppId).toHaveBeenCalledWith(
      'acc-1',
      'msg-1',
      {
        is_delivered: true,
        is_seen: true,
        is_sent: true,
      },
      data.key
    );
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      {
        ...data,
        patch: {
          is_delivered: true,
          is_seen: true,
          is_sent: true,
        },
      },
      'internal-message-id'
    );
    expect(kafkaServiceQueueService.updateMessageStatus).not.toHaveBeenCalled();
  });

  it('clears a due pending status when the ledger already covers it', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeStatusUpdate({ is_delivered: true });

    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusPendingService.isApplied.mockResolvedValue(true);

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(messageStatusPendingService.clearPendingStatus).toHaveBeenCalledWith(
      'acc-1',
      'msg-1'
    );
  });

  it('reschedules a due pending status when the target message is still missing', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeStatusUpdate({ is_delivered: true });

    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue(null);

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).toHaveBeenCalledWith(
      {
        ...data,
        patch: {
          is_delivered: true,
          is_sent: true,
        },
      },
      {
        batchSize: 1,
        duration: expect.any(Number),
      }
    );
  });
});
