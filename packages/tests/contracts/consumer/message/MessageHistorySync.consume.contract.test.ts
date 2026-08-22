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
    runtime_generation: 1,
    connection_epoch: 'connection-1',
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
  let receiptState: string | null = null;
  let receiptOwner: string | null = null;
  const redis = {
    get: jest.fn(async () =>
      JSON.stringify({
        worker_id: 'worker-1',
        runtime_generation: 1,
        connection_epoch: 'connection-1',
        connection_sequence: 1,
        source_provider: 'wwebjs',
        activated_at: Date.now() - 60 * 60 * 1000,
        state: 'active',
        activation_order: 1,
      })
    ),
    hget: jest.fn(async (_key: string, field: string) =>
      field === 'state' ? receiptState : null
    ),
    exists: jest.fn(async () => (receiptState ? 1 : 0)),
    sismember: jest.fn(async () => 0),
    eval: jest.fn(
      async (
        script: string,
        _keyCount: number,
        _key: string,
        ...args: string[]
      ) => {
        if (script.includes('message_history_receipt_reserve_v3')) {
          if (receiptState) {
            return ['duplicate', receiptState];
          }
          receiptState = 'reserved';
          receiptOwner = args[0];
          return ['acquired', 'reserved'];
        }
        if (script.includes('message_history_receipt_extend_v3')) {
          return (receiptState === 'reserved' ||
            receiptState === 'publishing') &&
            receiptOwner === args[0]
            ? Date.now() + 120_000
            : 0;
        }
        if (script.includes('message_history_receipt_mark_known_v3')) {
          receiptState = 'known';
          receiptOwner = null;
          return 1;
        }
        if (script.includes('message_history_receipt_transition_v3')) {
          const owner = args[0];
          const expectedState = args[1];
          const targetState = args[2];
          if (
            receiptState === 'known' ||
            receiptState === 'published' ||
            receiptState === 'ambiguous'
          ) {
            return 'already_completed';
          }
          if (receiptOwner !== owner) {
            return 'owner_mismatch';
          }
          if (receiptState === targetState) {
            return 'already_completed';
          }
          if (receiptState !== expectedState) {
            return 'invalid_state';
          }
          receiptState = targetState;
          if (targetState !== 'publishing') {
            receiptOwner = null;
          }
          return 'transitioned';
        }
        throw new Error('unexpected Redis script');
      }
    ),
  };
  const workerService = {
    viewWorkerForMonitorConsistent: jest.fn(async () => ({
      account_id: 'account-1',
      deleted_at: null,
      created_at: null,
    })),
  };
  const elasticDatabaseService = {
    select: jest.fn(async (..._args: unknown[]) => ({
      hits: { hits: [] as Array<{ _id?: string }> },
    })),
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
    redis,
    elasticDatabaseService,
    receiptState: () => receiptState,
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
  const originalHistoryReconciliationEnabled =
    process.env.HISTORY_RECONCILIATION_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-05-21T12:00:00.000Z') });
    process.env.HISTORY_RECONCILIATION_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalHistoryMaxAge === undefined) {
      delete process.env[legacyHistoryMaxAgeEnv];
    } else {
      process.env[legacyHistoryMaxAgeEnv] = originalHistoryMaxAge;
    }
    if (originalHistoryReconciliationEnabled === undefined) {
      delete process.env.HISTORY_RECONCILIATION_ENABLED;
    } else {
      process.env.HISTORY_RECONCILIATION_ENABLED =
        originalHistoryReconciliationEnabled;
    }
    jest.useRealTimers();
  });

  it('ignores the old max-age env override and rejects messages older than six hours', async () => {
    process.env[legacyHistoryMaxAgeEnv] = String(2 * 60 * 60 * 1000);
    const { consumer, streamProducerService } = makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 6 * 60 * 60 - 60)
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('publishes missing history from before the current activation inside the recovery window', async () => {
    const { consumer, redis, receiptState, streamProducerService } =
      makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 2 * 60 * 60)
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        from_history_sync: true,
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
    expect(receiptState()).toBe('published');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('message_history_receipt_reserve_v3'),
      1,
      expect.stringContaining('wa:received-msg:v2:event:account-1:worker-1:'),
      expect.any(String),
      expect.stringMatching(/^waevt_v1_/),
      expect.any(String),
      '2592000'
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        event_id: expect.stringMatching(/^waevt_v1_/),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
    const publishingCallIndex = redis.eval.mock.calls.findIndex(
      ([script, _keyCount, _key, _owner, expectedState, targetState]) =>
        String(script).includes('message_history_receipt_transition_v3') &&
        expectedState === 'reserved' &&
        targetState === 'publishing'
    );
    expect(publishingCallIndex).toBeGreaterThanOrEqual(0);
    expect(
      redis.eval.mock.invocationCallOrder[publishingCallIndex]
    ).toBeLessThan(streamProducerService.send.mock.invocationCallOrder[0]);
  });

  it('keeps an ambiguous ACK durable and does not republish on retry', async () => {
    const { consumer, redis, receiptState, streamProducerService } =
      makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);
    streamProducerService.send.mockRejectedValueOnce(new Error('kafka_down'));

    await expect(
      (consumer as any).handleHistoryMessage(makeUpsert(nowSeconds - 59 * 60))
    ).rejects.toThrow('kafka_down');

    expect(receiptState()).toBe('ambiguous');
    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('message_history_receipt_transition_v3'),
      1,
      expect.stringContaining('wa:received-msg:v2:event:account-1:worker-1:'),
      expect.any(String),
      'publishing',
      'ambiguous',
      '2592000',
      'kafka_down'
    );

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 59 * 60)
    );

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(receiptState()).toBe('ambiguous');
  });

  it('does not republish when Kafka succeeds but receipt finalization is unavailable', async () => {
    const { consumer, redis, receiptState, streamProducerService } =
      makeConsumer();
    const defaultEval = redis.eval.getMockImplementation();
    if (!defaultEval) {
      throw new Error('expected the Redis script mock');
    }
    redis.eval.mockImplementation(
      async (
        script: string,
        keyCount: number,
        key: string,
        ...args: string[]
      ) => {
        if (
          script.includes('message_history_receipt_transition_v3') &&
          args[2] === 'published'
        ) {
          throw new Error('redis unavailable after kafka ack');
        }
        return defaultEval(script, keyCount, key, ...args);
      }
    );
    const event = makeUpsert(Math.floor(Date.now() / 1000));

    await expect((consumer as any).handleHistoryMessage(event)).rejects.toThrow(
      'redis unavailable after kafka ack'
    );

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(receiptState()).toBe('publishing');

    await (consumer as any).handleHistoryMessage(
      makeUpsert(Math.floor(Date.now() / 1000))
    );

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(receiptState()).toBe('publishing');
  });

  it('marks the durable receipt known without publishing when ES already has the message', async () => {
    const {
      consumer,
      elasticDatabaseService,
      receiptState,
      streamProducerService,
    } = makeConsumer();
    elasticDatabaseService.select.mockResolvedValueOnce({
      hits: { hits: [{ _id: 'message-1' }] },
    });

    await (consumer as any).handleHistoryMessage(
      makeUpsert(Math.floor(Date.now() / 1000))
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(receiptState()).toBe('known');
  });

  it('discards history emitted by a connection epoch that is no longer active', async () => {
    const { consumer, redis, streamProducerService } = makeConsumer();
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        worker_id: 'worker-1',
        runtime_generation: 1,
        connection_epoch: 'connection-2',
        connection_sequence: 2,
        source_provider: 'wwebjs',
        activated_at: Date.now(),
        state: 'active',
        activation_order: 2,
      })
    );

    await (consumer as any).handleHistoryMessage(
      makeUpsert(Math.floor(Date.now() / 1000))
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('discards history for a worker that has already been deleted', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const workerService = (consumer as any).workerService;
    workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce({
      account_id: 'account-1',
      deleted_at: '2026-05-21T11:59:00.000Z',
      created_at: '2026-05-21T10:00:00.000Z',
    });

    await (consumer as any).handleHistoryMessage(
      makeUpsert(Math.floor(Date.now() / 1000))
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('fails closed when the shared inflight ledger is unavailable', async () => {
    const { consumer, redis, streamProducerService } = makeConsumer();
    redis.hget.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      (consumer as any).handleHistoryMessage(
        makeUpsert(Math.floor(Date.now() / 1000))
      )
    ).rejects.toThrow('redis unavailable');

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('keeps an active reservation uncommitted so its expired lease can be recovered', async () => {
    const { consumer, redis, streamProducerService } = makeConsumer();
    redis.eval.mockResolvedValueOnce(['duplicate', 'reserved']);

    await expect(
      (consumer as any).handleHistoryMessage(
        makeUpsert(Math.floor(Date.now() / 1000))
      )
    ).rejects.toThrow('message_history_receipt_reservation_busy');

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('keeps history reconciliation disabled when explicitly disabled', async () => {
    process.env.HISTORY_RECONCILIATION_ENABLED = 'false';
    const { consumer, streamProducerService } = makeConsumer();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await (consumer as any).handleHistoryMessage(
      makeUpsert(nowSeconds - 10 * 60)
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });
});
