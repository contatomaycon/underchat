import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.replace(/@c\.us$/, '@s.whatsapp.net'),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { MessageHistorySyncConsume } from '@core/consumer/message/MessageHistorySync.consume';

function makeUpsert(messageTimestamp: number): IUpsertMessage {
  return {
    account_id: 'account-1',
    worker_id: 'worker-1',
    source_provider: 'wwebjs',
    type: EMessageType.text,
    has_quoted: false,
    message: {
      key: {
        id: 'false_556999715039@s.whatsapp.net_message-1',
        remoteJid: '556999715039@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'Oi',
      },
      messageTimestamp,
    },
  };
}

function makeConsumer() {
  const redis = {
    sismember: jest.fn(async () => 0),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => undefined),
  };
  const workerService = {
    viewWorker: jest.fn(async () => ({
      connection_date: null,
      created_at: null,
    })),
  };
  const elasticDatabaseService = {
    select: jest.fn(async () => ({ hits: { hits: [] } })),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    upsertMessage: jest.fn(() => 'upsert.message'),
    upsertMessageHistory: jest.fn(() => 'upsert.message.history'),
  };

  return {
    consumer: new MessageHistorySyncConsume(
      redis as never,
      {} as never,
      kafkaServiceQueueService as never,
      elasticDatabaseService as never,
      workerService as never,
      streamProducerService as never
    ),
    streamProducerService,
  };
}

describe('MessageHistorySyncConsume', () => {
  const legacyHistoryMaxAgeEnv = [
    'HISTORY',
    'RECONCILIATION',
    'MAX',
    'AGE',
    'MS',
  ].join('_');
  const originalHistoryMaxAge = process.env[legacyHistoryMaxAgeEnv];

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-05-21T12:00:00.000Z') });
  });

  afterEach(() => {
    if (originalHistoryMaxAge === undefined) {
      delete process.env[legacyHistoryMaxAgeEnv];
    } else {
      process.env[legacyHistoryMaxAgeEnv] = originalHistoryMaxAge;
    }
    jest.useRealTimers();
  });

  it('ignores the old max-age env override and rejects messages older than 60 minutes', async () => {
    process.env[legacyHistoryMaxAgeEnv] = String(2 * 60 * 60 * 1000);
    const { consumer, streamProducerService } = makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 61 * 60)
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('publishes missing recent history inside the 60 minute window', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 59 * 60)
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        from_history_sync: true,
      }),
      expect.any(String)
    );
  });
});
