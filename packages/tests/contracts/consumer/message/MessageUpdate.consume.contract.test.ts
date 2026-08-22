import 'reflect-metadata';
import { EventEmitter } from 'node:events';

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

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
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
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { buildMessageUpdateEventId } from '@core/common/functions/messageUpdateIdentity';
import { UnrecoverableAuxiliaryRuntimeEventError } from '@core/consumer/auxiliaryRuntimeRebind';

const { setImmediate: scheduleRealImmediate } =
  jest.requireActual<typeof import('node:timers')>('node:timers');

async function waitForCondition(
  condition: () => boolean,
  description: string,
  maxTurns = 50
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => scheduleRealImmediate(resolve));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

class RuntimeAdmissionFakeConsumer extends EventEmitter {
  pause = jest.fn();
  resume = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
  __isLatestAssignmentCutoverCommitted = jest.fn(() => true);
  __isAssignmentEpochActive = jest.fn(() => true);
  __subscribeAssignmentInvalidation = jest.fn(() => () => undefined);
  __restartGenerationWithoutCommit = jest.fn();

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'data' && args[0] && typeof args[0] === 'object') {
      return super.emit(eventName, {
        ...(args[0] as object),
        consumerAssignmentEpoch: 1,
      });
    }
    return super.emit(eventName, ...args);
  }
}

function managedMessageUpdate(
  provider: 'baileys' | 'wwebjs' | 'whatsmeow' = 'wwebjs'
): IUpdateMessage {
  const update: IUpdateMessage = {
    worker_id: 'worker-1',
    source_provider: provider,
    runtime_generation: 7,
    connection_epoch: 'epoch-7',
    data: {
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
      message_id: 'internal-1',
    },
    message: { key: { id: 'provider-1' } },
  } as IUpdateMessage;
  update.event_id = buildMessageUpdateEventId(update) ?? undefined;
  return update;
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
    const chatService = {
      patchExistingMessageMissingFields: jest.fn().mockResolvedValue(true),
    };
    const consumer = new MessageUpdateConsume(
      redis as never,
      {} as never,
      kafkaServiceQueueService as never,
      elasticDatabaseService as never,
      messageStatusPendingService as never,
      chatService as never
    );
    const data: IUpdateMessage = {
      data: {
        account: { id: 'acc-1' },
        worker: { id: 'worker-1' },
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

    expect(chatService.patchExistingMessageMissingFields).toHaveBeenCalledWith(
      'internal-1',
      expect.objectContaining({
        message_key: expect.objectContaining({ id: '3EB123' }),
      }),
      expect.objectContaining({
        eventTypes: ['message.updated'],
        source: 'message_update',
        changes: expect.objectContaining({ message_key_hydrated: true }),
      })
    );
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.any(Object),
      {
        maxRetries: 5,
        assertActive: expect.any(Function),
      }
    );
    expect(
      messageStatusPendingService.setInternalMessageIdAlias
    ).toHaveBeenCalledWith('acc-1', '3EB123', 'internal-1', 'worker-1');
    expect(messageStatusPendingService.wakePendingStatus).toHaveBeenCalledWith(
      'acc-1',
      '3EB123',
      'worker-1'
    );
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'rebinds a durable %s message result after runtime rotation and keeps the idempotency identity stable',
    async (provider) => {
      const redis = { del: jest.fn().mockResolvedValue(1) };
      const messageStatusPendingService = {
        setInternalMessageIdAlias: jest.fn().mockResolvedValue(undefined),
        wakePendingStatus: jest.fn().mockResolvedValue(true),
      };
      const chatService = {
        patchExistingMessageMissingFields: jest.fn().mockResolvedValue(true),
      };
      const consumer = new MessageUpdateConsume(
        redis as never,
        {} as never,
        { updateMessage: jest.fn(() => 'update.message') } as never,
        { updateWithScriptOCC: jest.fn() } as never,
        messageStatusPendingService as never,
        chatService as never
      );
      const lease = {
        assertOwned: jest.fn(),
        release: jest.fn(async () => true),
      };
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({
          state: 'active' as const,
          fence: {
            worker_id: 'worker-1',
            source_provider: provider,
            runtime_generation: 22,
            connection_epoch: `${provider}-epoch-22`,
            connection_sequence: 4,
            activated_at: Date.now(),
            state: 'active' as const,
            activation_order: 4,
          },
        })),
        acquireEffectLease: jest.fn(async () => lease),
        isCurrent: jest.fn(async () => false),
      };
      (consumer as any).runtimeFence = runtimeFence;
      const rotatedEvent: IUpdateMessage = {
        worker_id: 'worker-1',
        source_provider: provider,
        runtime_generation: 21,
        connection_epoch: `${provider}-epoch-21`,
        data: {
          account: { id: 'acc-1' },
          worker: { id: 'worker-1' },
          message_id: 'internal-1',
        },
        message: {
          key: {
            id: 'provider-message-1',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
          },
        },
      } as IUpdateMessage;
      rotatedEvent.event_id =
        buildMessageUpdateEventId(rotatedEvent) ?? undefined;
      const stableEventId = rotatedEvent.event_id;

      await expect(
        (consumer as any).acquireRuntimeEffectLease(rotatedEvent)
      ).resolves.toBe(lease);
      await (consumer as any).handleMessage(rotatedEvent, jest.fn());
      await (consumer as any).handleMessage(rotatedEvent, jest.fn());

      expect(rotatedEvent).toMatchObject({
        event_id: stableEventId,
        worker_id: 'worker-1',
        source_provider: provider,
        runtime_generation: 22,
        connection_epoch: `${provider}-epoch-22`,
      });
      expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(
        chatService.patchExistingMessageMissingFields
      ).toHaveBeenCalledTimes(2);
      for (const call of chatService.patchExistingMessageMissingFields.mock
        .calls) {
        expect(call[2]).toEqual(
          expect.objectContaining({
            idempotencyKey: `message-key-hydrated:${stableEventId}`,
          })
        );
      }
    }
  );

  it('keeps a valid official WhatsApp update unfenced without requiring generation or epoch', async () => {
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      { patchExistingMessageMissingFields: jest.fn() } as never
    );
    const lease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => true),
    };
    const runtimeFence = {
      view: jest.fn(),
      acquireEffectLease: jest.fn(async () => lease),
    };
    (consumer as any).runtimeFence = runtimeFence;
    const officialUpdate: IUpdateMessage = {
      worker_id: 'official-worker-1',
      source_provider: 'official_whatsapp',
      data: {
        account: { id: 'account-1' },
        worker: { id: 'official-worker-1' },
        message_id: 'internal-1',
      },
      message: { key: { id: 'wamid.official-1' } },
    } as IUpdateMessage;
    officialUpdate.event_id =
      buildMessageUpdateEventId(officialUpdate) ?? undefined;

    await expect(
      (consumer as any).acquireRuntimeEffectLease(officialUpdate)
    ).resolves.toBe(lease);

    expect(runtimeFence.view).not.toHaveBeenCalled();
    expect(runtimeFence.acquireEffectLease).toHaveBeenCalledWith(
      officialUpdate
    );
    expect(officialUpdate.runtime_generation).toBeUndefined();
    expect(officialUpdate.connection_epoch).toBeUndefined();
  });

  it('fails closed before Elasticsearch when message account/worker/event identities disagree', async () => {
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      chatService as never
    );
    const runtimeFence = {
      viewAdmissionState: jest.fn(),
      acquireEffectLease: jest.fn(),
    };
    (consumer as any).runtimeFence = runtimeFence;
    const crossWorker = {
      event_id: 'forged-event',
      worker_id: 'worker-1',
      source_provider: 'baileys',
      runtime_generation: 5,
      connection_epoch: 'epoch-5',
      data: {
        account: { id: 'account-1' },
        worker: { id: 'worker-2' },
        message_id: 'internal-1',
      },
      message: { key: { id: 'provider-1' } },
    } as IUpdateMessage;

    await expect(
      (consumer as any).acquireRuntimeEffectLease(crossWorker)
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
    });
    expect(runtimeFence.viewAdmissionState).not.toHaveBeenCalled();
    expect(
      chatService.patchExistingMessageMissingFields
    ).not.toHaveBeenCalled();
  });

  it('commits a forged durable message-update poison record through the real runner', async () => {
    const fakeConsumer = new RuntimeAdmissionFakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    (connectConsumer as jest.Mock).mockImplementation(
      (_consumer, _topic, callback) => callback?.()
    );
    (commitOffset as jest.Mock).mockResolvedValue(undefined);
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      { getBroker: jest.fn(() => 'broker-a:9092') } as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      chatService as never
    );
    const poison: IUpdateMessage = {
      event_id: 'forged-message-update',
      worker_id: 'worker-1',
      source_provider: 'baileys',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
      data: {
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        message_id: 'internal-1',
      },
      message: { key: { id: 'provider-1' } },
    } as IUpdateMessage;

    await consumer.execute();
    fakeConsumer.emit('data', {
      topic: 'update.message',
      value: Buffer.from(JSON.stringify(poison)),
      partition: 2,
      offset: 50,
    });
    await waitForCondition(
      () => (commitOffset as jest.Mock).mock.calls.length === 1,
      'terminal poison commit'
    );

    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'update.message',
      2,
      50
    );
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();
    expect(
      chatService.patchExistingMessageMissingFields
    ).not.toHaveBeenCalled();
    await consumer.close();
  });

  it.each(['missing', 'invalid'] as const)(
    'commits a managed update with a %s Redis fence only after authoritative database rejection',
    async (state) => {
      const fakeConsumer = new RuntimeAdmissionFakeConsumer();
      (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
      (connectConsumer as jest.Mock).mockImplementation(
        (_consumer, _topic, callback) => callback?.()
      );
      (commitOffset as jest.Mock).mockResolvedValue(undefined);
      const chatService = {
        patchExistingMessageMissingFields: jest.fn(),
      };
      const consumer = new MessageUpdateConsume(
        { del: jest.fn() } as never,
        { getBroker: jest.fn(() => 'broker-a:9092') } as never,
        { updateMessage: jest.fn(() => 'update.message') } as never,
        { updateWithScriptOCC: jest.fn() } as never,
        {
          setInternalMessageIdAlias: jest.fn(),
          wakePendingStatus: jest.fn(),
        } as never,
        chatService as never
      );
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({ state })),
        acquireEffectLease: jest.fn(),
        isCurrent: jest.fn(),
      };
      (consumer as any).runtimeFence = runtimeFence;
      const durableRecovery = jest.fn(async () => {
        throw new UnrecoverableAuxiliaryRuntimeEventError(
          `durable_runtime_fence_${state}_stale`
        );
      });
      (consumer as any).acquireDatabaseRuntimeEffectLease = durableRecovery;

      try {
        await consumer.execute();
        fakeConsumer.emit('data', {
          topic: 'update.message',
          value: Buffer.from(JSON.stringify(managedMessageUpdate())),
          partition: 2,
          offset: 51,
        });
        await waitForCondition(
          () => (commitOffset as jest.Mock).mock.calls.length === 1,
          `${state} runtime terminal commit`
        );

        expect(runtimeFence.viewAdmissionState).toHaveBeenCalledTimes(1);
        expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
        expect(durableRecovery).toHaveBeenCalledWith(
          expect.objectContaining({
            worker_id: 'worker-1',
            source_provider: 'wwebjs',
          }),
          `runtime_fence_${state}`
        );
        expect(
          chatService.patchExistingMessageMissingFields
        ).not.toHaveBeenCalled();
        expect(
          fakeConsumer.__restartGenerationWithoutCommit
        ).not.toHaveBeenCalled();
        expect(commitOffset).toHaveBeenCalledWith(
          fakeConsumer,
          'update.message',
          2,
          51
        );
      } finally {
        await consumer.close();
      }
    }
  );

  it('processes and commits a missing Redis fence through an exact database runtime lease', async () => {
    const fakeConsumer = new RuntimeAdmissionFakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    (connectConsumer as jest.Mock).mockImplementation(
      (_consumer, _topic, callback) => callback?.()
    );
    (commitOffset as jest.Mock).mockResolvedValue(undefined);
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(async () => true),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      { getBroker: jest.fn(() => 'broker-a:9092') } as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      chatService as never
    );
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'missing' as const,
      })),
      acquireEffectLease: jest.fn(),
      isCurrent: jest.fn(),
    };
    const databaseLease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => undefined),
    };
    const durableRecovery = jest.fn(async (candidate: IUpdateMessage) => {
      expect(candidate).toMatchObject({
        runtime_generation: 7,
        connection_epoch: 'epoch-7',
      });
      return {
        lease: databaseLease,
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
        runtime_generation: 9,
        connection_epoch: 'epoch-9',
      };
    });
    (consumer as any).runtimeFence = runtimeFence;
    (consumer as any).acquireDatabaseRuntimeEffectLease = durableRecovery;

    try {
      await consumer.execute();
      fakeConsumer.emit('data', {
        topic: 'update.message',
        value: Buffer.from(JSON.stringify(managedMessageUpdate())),
        partition: 2,
        offset: 52,
      });
      await waitForCondition(
        () => (commitOffset as jest.Mock).mock.calls.length === 1,
        'database runtime recovery commit'
      );

      expect(durableRecovery).toHaveBeenCalledWith(
        expect.any(Object),
        'runtime_fence_missing'
      );
      expect(
        chatService.patchExistingMessageMissingFields
      ).toHaveBeenCalledTimes(1);
      expect(databaseLease.release).toHaveBeenCalledTimes(1);
      expect(
        fakeConsumer.__restartGenerationWithoutCommit
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        fakeConsumer,
        'update.message',
        2,
        52
      );
    } finally {
      await consumer.close();
    }
  });

  it('recovers a Redis provider mismatch when the database proves the event provider is current', async () => {
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      { patchExistingMessageMissingFields: jest.fn() } as never
    );
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'active' as const,
        fence: {
          worker_id: 'worker-1',
          source_provider: 'wwebjs' as const,
          runtime_generation: 8,
          connection_epoch: 'wwebjs-epoch-8',
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: 2,
        },
      })),
      acquireEffectLease: jest.fn(),
    };
    const databaseLease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => undefined),
    };
    const durableRecovery = jest.fn(async () => ({
      lease: databaseLease,
      worker_id: 'worker-1',
      source_provider: 'baileys',
      runtime_generation: 10,
      connection_epoch: 'baileys-epoch-10',
    }));
    (consumer as any).runtimeFence = runtimeFence;
    (consumer as any).acquireDatabaseRuntimeEffectLease = durableRecovery;
    const update = managedMessageUpdate('baileys');

    await expect(
      (consumer as any).acquireRuntimeEffectLease(update)
    ).resolves.toBe(databaseLease);
    expect(durableRecovery).toHaveBeenCalledWith(
      update,
      'worker_provider_mismatch'
    );
    expect(update).toMatchObject({
      source_provider: 'baileys',
      runtime_generation: 10,
      connection_epoch: 'baileys-epoch-10',
    });
  });

  it('holds the exact database runtime lock until the recovered effect lease is released', async () => {
    const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const workerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const runtimeEpoch = '99999999-9999-4999-8999-999999999999';
    const runtime = {
      worker_id: workerId,
      source_provider: 'wwebjs',
      runtime_generation: 9,
      connection_epoch: runtimeEpoch,
      connection_sequence: 4,
    };
    const queryExecute = jest
      .fn()
      .mockResolvedValueOnce([runtime])
      .mockResolvedValueOnce([{ worker_id: workerId }])
      .mockResolvedValueOnce([
        {
          worker_id: workerId,
          source_provider: 'wwebjs',
          runtime_generation: 9,
          connection_epoch: runtimeEpoch,
          connection_sequence: 4,
          disconnected_connection_epoch: null,
          connection_disconnected_at: null,
        },
      ])
      .mockResolvedValueOnce([runtime]);
    const query: Record<string, jest.Mock> = {};
    for (const method of ['from', 'where', 'for', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = queryExecute;
    const tx = {
      execute: jest.fn(async () => undefined),
      select: jest.fn(() => query),
    };
    const database = {
      transaction: jest.fn(
        async (callback: (transaction: never) => Promise<void>) =>
          callback(tx as never)
      ),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      { patchExistingMessageMissingFields: jest.fn() } as never,
      database as never
    );

    const update = managedMessageUpdate();
    update.worker_id = workerId;
    update.data.account.id = accountId;
    update.data.worker.id = workerId;
    const recovery = await (consumer as any).acquireDatabaseRuntimeEffectLease(
      update,
      'runtime_fence_missing'
    );
    const transactionCompletion = database.transaction.mock.results[0]
      ?.value as Promise<void>;
    let transactionSettled = false;
    void transactionCompletion.then(() => {
      transactionSettled = true;
    });
    await new Promise<void>((resolve) => scheduleRealImmediate(resolve));

    expect(recovery).toMatchObject({
      worker_id: workerId,
      source_provider: 'wwebjs',
      runtime_generation: 9,
      connection_epoch: runtimeEpoch,
    });
    expect(tx.execute).toHaveBeenCalledTimes(3);
    expect(query.for).toHaveBeenNthCalledWith(1, 'share');
    expect(query.for).toHaveBeenNthCalledWith(2, 'share');
    expect(transactionSettled).toBe(false);
    expect(() => recovery.lease.assertOwned()).not.toThrow();

    await recovery.lease.release();
    await transactionCompletion;
    expect(transactionSettled).toBe(true);
  });

  it('terminally rejects database recovery when the durable provider is different', async () => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['from', 'where', 'for', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn(async () => [
      {
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
        runtime_generation: 9,
        connection_epoch: 'epoch-9',
        connection_sequence: 4,
      },
    ]);
    const tx = {
      execute: jest.fn(async () => undefined),
      select: jest.fn(() => query),
    };
    const database = {
      transaction: jest.fn(
        async (callback: (transaction: never) => Promise<void>) =>
          callback(tx as never)
      ),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      { patchExistingMessageMissingFields: jest.fn() } as never,
      database as never
    );

    await expect(
      (consumer as any).acquireDatabaseRuntimeEffectLease(
        managedMessageUpdate('baileys'),
        'worker_provider_mismatch'
      )
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
      detail: 'durable_worker_provider_mismatch_stale',
    });
    expect(query.for).not.toHaveBeenCalled();
  });

  it('bounds an activating runtime retry and then commits without restarting the generation', async () => {
    jest.useFakeTimers();
    const fakeConsumer = new RuntimeAdmissionFakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    (connectConsumer as jest.Mock).mockImplementation(
      (_consumer, _topic, callback) => callback?.()
    );
    (commitOffset as jest.Mock).mockResolvedValue(undefined);
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      { getBroker: jest.fn(() => 'broker-a:9092') } as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      chatService as never
    );
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'activating' as const,
      })),
      acquireEffectLease: jest.fn(),
      isCurrent: jest.fn(),
    };
    (consumer as any).runtimeFence = runtimeFence;
    const durableRecovery = jest.fn(async () => {
      throw new UnrecoverableAuxiliaryRuntimeEventError(
        'durable_runtime_activating_stale'
      );
    });
    (consumer as any).acquireDatabaseRuntimeEffectLease = durableRecovery;

    try {
      await consumer.execute();
      fakeConsumer.emit('data', {
        topic: 'update.message',
        value: Buffer.from(JSON.stringify(managedMessageUpdate())),
        partition: 2,
        offset: 52,
      });
      await waitForCondition(
        () => runtimeFence.viewAdmissionState.mock.calls.length === 1,
        'first activating runtime admission lookup'
      );

      expect(commitOffset).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_250);
      await waitForCondition(
        () => (commitOffset as jest.Mock).mock.calls.length === 1,
        'bounded activating runtime commit'
      );

      expect(runtimeFence.viewAdmissionState).toHaveBeenCalledTimes(3);
      expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
      expect(durableRecovery).toHaveBeenCalledTimes(1);
      expect(
        chatService.patchExistingMessageMissingFields
      ).not.toHaveBeenCalled();
      expect(
        fakeConsumer.__restartGenerationWithoutCommit
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        fakeConsumer,
        'update.message',
        2,
        52
      );
    } finally {
      await consumer.close();
      jest.useRealTimers();
    }
  });

  it('retries an activating runtime in place and commits only after the active lease is acquired', async () => {
    jest.useFakeTimers();
    const fakeConsumer = new RuntimeAdmissionFakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    (connectConsumer as jest.Mock).mockImplementation(
      (_consumer, _topic, callback) => callback?.()
    );
    (commitOffset as jest.Mock).mockResolvedValue(undefined);
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(),
    };
    const consumer = new MessageUpdateConsume(
      { del: jest.fn() } as never,
      { getBroker: jest.fn(() => 'broker-a:9092') } as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      { updateWithScriptOCC: jest.fn() } as never,
      {
        setInternalMessageIdAlias: jest.fn(),
        wakePendingStatus: jest.fn(),
      } as never,
      chatService as never
    );
    const lease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => true),
    };
    const runtimeFence = {
      viewAdmissionState: jest
        .fn()
        .mockResolvedValueOnce({ state: 'activating' as const })
        .mockResolvedValueOnce({
          state: 'active' as const,
          fence: {
            worker_id: 'worker-1',
            source_provider: 'wwebjs' as const,
            runtime_generation: 8,
            connection_epoch: 'epoch-8',
            connection_sequence: 2,
            activated_at: Date.now(),
            state: 'active' as const,
            activation_order: 2,
          },
        }),
      acquireEffectLease: jest.fn(async () => lease),
      isCurrent: jest.fn(async () => false),
    };
    (consumer as any).runtimeFence = runtimeFence;
    const duringActivation: IUpdateMessage = {
      worker_id: 'worker-1',
      source_provider: 'wwebjs',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
      data: {
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        message_id: 'internal-1',
      },
      message: { key: { id: 'provider-1' } },
    } as IUpdateMessage;
    duringActivation.event_id =
      buildMessageUpdateEventId(duringActivation) ?? undefined;

    try {
      await consumer.execute();
      fakeConsumer.emit('data', {
        topic: 'update.message',
        value: Buffer.from(JSON.stringify(duringActivation)),
        partition: 2,
        offset: 51,
      });
      await waitForCondition(
        () => runtimeFence.viewAdmissionState.mock.calls.length === 1,
        'first runtime admission lookup'
      );

      expect(commitOffset).not.toHaveBeenCalled();
      expect(
        fakeConsumer.__restartGenerationWithoutCommit
      ).not.toHaveBeenCalled();
      expect(
        chatService.patchExistingMessageMissingFields
      ).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(250);
      await waitForCondition(
        () => (commitOffset as jest.Mock).mock.calls.length === 1,
        'runtime lease recovery commit'
      );

      expect(runtimeFence.viewAdmissionState).toHaveBeenCalledTimes(2);
      expect(runtimeFence.acquireEffectLease).toHaveBeenCalledTimes(1);
      expect(runtimeFence.acquireEffectLease).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: duringActivation.event_id,
          runtime_generation: 8,
          connection_epoch: 'epoch-8',
        })
      );
      expect(
        fakeConsumer.__restartGenerationWithoutCommit
      ).not.toHaveBeenCalled();
      expect(
        chatService.patchExistingMessageMissingFields
      ).toHaveBeenCalledTimes(1);
      expect(lease.release).toHaveBeenCalledTimes(1);
      expect(commitOffset).toHaveBeenCalledWith(
        fakeConsumer,
        'update.message',
        2,
        51
      );
    } finally {
      await consumer.close();
      jest.useRealTimers();
    }
  });

  it('retries update failures without committing the offset', async () => {
    const handlers: Record<string, (...args: any[]) => unknown> = {};
    const kafkaConsumer: {
      on: jest.Mock;
      commit: jest.Mock;
      unsubscribe: jest.Mock;
      disconnect: jest.Mock;
      __isLatestAssignmentCutoverCommitted: jest.Mock;
      __isAssignmentEpochActive: jest.Mock;
    } = {
      on: jest.fn(),
      commit: jest.fn(),
      unsubscribe: jest.fn(),
      disconnect: jest.fn((callback?: () => void) => callback?.()),
      __isLatestAssignmentCutoverCommitted: jest.fn(() => true),
      __isAssignmentEpochActive: jest.fn(() => true),
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
    const chatService = {
      patchExistingMessageMissingFields: jest.fn().mockResolvedValue(true),
    };
    const kafka = {
      getBroker: jest.fn(() => 'broker-a:9092'),
    };
    const consumer = new MessageUpdateConsume(
      redis as never,
      kafka as never,
      kafkaServiceQueueService as never,
      elasticDatabaseService as never,
      messageStatusPendingService as never,
      chatService as never
    );
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await consumer.execute();
      // The production drain remains deliberately generous. This contract
      // keeps a technical failure in redrive, so bound only the test shutdown.
      (consumer as any).runner.shutdownDrainTimeoutMs = 25;
      const data: IUpdateMessage = {
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        data: {
          account: { id: 'acc-1' },
          worker: { id: 'worker-1' },
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
      data.event_id = buildMessageUpdateEventId(data) ?? undefined;

      handlers.data?.({
        value: Buffer.from(JSON.stringify(data)),
        partition: 3,
        offset: 41,
        consumerAssignmentEpoch: 1,
      });
      await waitForCondition(
        () =>
          consoleSpy.mock.calls.some(
            (call) => call[0] === '[MessageUpdateConsume] message update failed'
          ),
        'the message update failure hook'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageUpdateConsume] message update failed',
        expect.objectContaining({
          topic: 'update.message',
          partition: 3,
          offset: 41,
          error: expect.any(Error),
        })
      );
      expect(commitOffset).not.toHaveBeenCalled();
    } finally {
      await consumer.close();
      consoleSpy.mockRestore();
    }
  });

  it('stops after the chat mutation when the assignment is revoked before cache and message effects', async () => {
    let active = true;
    const redis = {
      del: jest.fn().mockResolvedValue(1),
    };
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn(async () => {
        active = false;
        return 'updated';
      }),
    };
    const messageStatusPendingService = {
      setInternalMessageIdAlias: jest.fn(),
      wakePendingStatus: jest.fn(),
    };
    const chatService = {
      patchExistingMessageMissingFields: jest.fn(),
    };
    const consumer = new MessageUpdateConsume(
      redis as never,
      {} as never,
      { updateMessage: jest.fn(() => 'update.message') } as never,
      elasticDatabaseService as never,
      messageStatusPendingService as never,
      chatService as never
    );
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });
    const data = {
      data: {
        account: { id: 'acc-1' },
        worker: { id: 'worker-1' },
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

    await expect(
      (consumer as any).handleMessage(data, assertActive)
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(redis.del).not.toHaveBeenCalled();
    expect(
      chatService.patchExistingMessageMissingFields
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.setInternalMessageIdAlias
    ).not.toHaveBeenCalled();
  });
});
