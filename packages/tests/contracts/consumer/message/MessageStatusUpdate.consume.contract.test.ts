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

jest.mock('@core/services/officialWhatsappConversationWindow.service', () => ({
  OfficialWhatsappConversationWindowService: class OfficialWhatsappConversationWindowService {},
}));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import type { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { buildMessageStatusEventId } from '@core/common/functions/messageStatusIdentity';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { CriticalRedisOperationError } from '@core/common/functions/criticalRedisOperation';
import { AuxiliaryRuntimeLeaseRaceError } from '@core/consumer/auxiliaryRuntimeRebind';

const { MessageStatusUpdateConsume } =
  require('@core/consumer/message/MessageStatusUpdate.consume') as typeof import('@core/consumer/message/MessageStatusUpdate.consume');

describe('MessageStatusUpdateConsume', () => {
  const makeConsumer = () => {
    const redis = {
      exists: jest.fn().mockResolvedValue(0),
      get: jest.fn().mockResolvedValue(null),
      hget: jest.fn().mockResolvedValue(null),
      hset: jest.fn().mockResolvedValue(1),
      setex: jest.fn().mockResolvedValue('OK'),
      zadd: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue(null),
      eval: jest.fn(async (...args: unknown[]) => {
        if (args[1] === 2) {
          return 1;
        }
        return [
          1,
          JSON.stringify({
            state: 'active',
            worker_id: args[5],
            runtime_generation: Number(args[6]),
            connection_epoch: args[7],
            connection_sequence: 1,
            source_provider: args[8],
            activated_at: Date.now(),
            activation_order: 1,
          }),
          Date.now() + 300_000,
        ];
      }),
    };
    const messageStatusService = {
      updateSummaryByWhatsAppId: jest.fn(),
      markMessageAsNotSent: jest.fn(),
      markMessageAsNotSentByWhatsAppId: jest.fn(),
    };
    const messageStatusPendingService = {
      discardLegacyPendingStatuses: jest.fn().mockResolvedValue(0),
      deferMissingStatusUpdate: jest.fn().mockResolvedValue(undefined),
      claimDuePendingStatuses: jest.fn().mockResolvedValue([]),
      withClaimHeartbeat: jest.fn(
        async (
          _data: IMessageStatusUpdate,
          callback: (assertClaimActive: () => Promise<void>) => Promise<void>
        ) => callback(async () => undefined)
      ),
      clearPendingStatus: jest.fn().mockResolvedValue(undefined),
      clearPendingStatusIfCovered: jest.fn().mockResolvedValue(true),
      discardClaimedPendingStatus: jest.fn().mockResolvedValue(true),
      discardPendingStatusForEvent: jest.fn().mockResolvedValue(true),
      isApplied: jest.fn().mockResolvedValue(false),
      markApplied: jest.fn().mockResolvedValue(true),
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
    const officialWindowService = {
      recordProviderAcceptedMessage: jest.fn().mockResolvedValue(undefined),
      recordTemplateFailureForMessage: jest.fn().mockResolvedValue(undefined),
      recordTemplateUncertainForMessage: jest.fn().mockResolvedValue(undefined),
    };

    const consumer = new MessageStatusUpdateConsume(
      {} as never,
      kafkaServiceQueueService as never,
      messageStatusService as never,
      messageStatusPendingService as never,
      officialWindowService as never,
      redis as never
    );
    (consumer as any).consumerInstanceId = 'consumer-pod-a';
    (consumer as any).consumer = {
      __isAssignmentEpochActive: jest.fn(() => true),
      __health: jest.fn(() => ({
        assignment_epoch: 7,
        assignments: [{ topic: 'update.message.status', partition: 2 }],
      })),
    };

    return {
      consumer,
      kafkaServiceQueueService,
      redis,
      messageStatusService,
      messageStatusPendingService,
      officialWindowService,
    };
  };

  const makeStatusUpdate = (
    patch: IMessageStatusUpdate['patch'] = { is_delivered: true }
  ): IMessageStatusUpdate => ({
    event_id: 'status-event-1',
    account_id: 'acc-1',
    worker_id: 'worker-1',
    message_id: 'msg-1',
    patch,
    consumer_assignment_owner: 'consumer-pod-a',
    consumer_assignment_epoch: 7,
    consumer_partition: 2,
    key: {
      id: 'msg-1',
      fromMe: true,
      remoteJid: '5511999999999@s.whatsapp.net',
    },
  });

  const makeManagedStatusUpdate = (
    patch: IMessageStatusUpdate['patch'],
    provider: 'baileys' | 'wwebjs' | 'whatsmeow' = 'baileys'
  ): IMessageStatusUpdate => {
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate(patch),
      source_provider: provider,
      runtime_generation: 7,
      connection_epoch: `${provider}-epoch-7`,
    };
    data.event_id = buildMessageStatusEventId(data) ?? undefined;
    return data;
  };

  const configureActiveRuntime = (
    consumer: InstanceType<typeof MessageStatusUpdateConsume>,
    provider: 'baileys' | 'wwebjs' | 'whatsmeow' = 'baileys'
  ) => {
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
          runtime_generation: 8,
          connection_epoch: `${provider}-epoch-8`,
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: 2,
        },
      })),
      acquireEffectLease: jest.fn(async () => lease),
      isCurrent: jest.fn(async () => true),
    };
    (consumer as any).runtimeFence = runtimeFence;
    return { lease, runtimeFence };
  };

  it('keeps critical Redis failures on the Kafka partition without committing', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer } = makeConsumer();

    try {
      await consumer.execute();
      const options = (consumer as any).runner.options;
      expect(
        options.shouldContinueRetryWithoutCommit(
          makeStatusUpdate(),
          {},
          new CriticalRedisOperationError(
            'message_status_mark_applied',
            new Error('redis unavailable')
          )
        )
      ).toBe(true);
      expect(
        options.shouldContinueRetryWithoutCommit(
          makeStatusUpdate(),
          {},
          new Error('ordinary business failure')
        )
      ).toBe(false);
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('durably hands an auxiliary runtime race to the pending store with the active assignment', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer, messageStatusPendingService } = makeConsumer();
    const status = makeManagedStatusUpdate({ is_delivered: true }, 'whatsmeow');
    const assertActive = jest.fn();
    const reportProgress = jest.fn();
    const race = new CriticalRedisOperationError(
      'runtime_effect_lease_acquire',
      new AuxiliaryRuntimeLeaseRaceError()
    );

    try {
      await consumer.execute();
      const options = (consumer as any).runner.options;
      await expect(
        options.recoverEffectLeaseAcquisitionFailure(
          status,
          {
            message: { consumerAssignmentEpoch: 14 },
            partition: 5,
            assertActive,
            reportProgress,
          },
          race
        )
      ).resolves.toBe('durable_handoff');

      expect(
        messageStatusPendingService.reschedulePendingStatus
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: status.event_id,
          account_id: 'acc-1',
          worker_id: 'worker-1',
          source_provider: 'whatsmeow',
          consumer_assignment_owner: 'consumer-pod-a',
          consumer_assignment_epoch: 14,
          consumer_partition: 5,
        }),
        { batchSize: 1, duration: 0 },
        { incrementRetry: false }
      );
      expect(assertActive).toHaveBeenCalledTimes(3);
      expect(reportProgress).toHaveBeenCalledTimes(1);
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('fails closed and reports no progress when the runtime-race handoff cannot be persisted', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer, messageStatusPendingService } = makeConsumer();
    messageStatusPendingService.reschedulePendingStatus.mockRejectedValueOnce(
      new Error('redis unavailable')
    );
    const assertActive = jest.fn();
    const reportProgress = jest.fn();

    try {
      await consumer.execute();
      const options = (consumer as any).runner.options;
      await expect(
        options.recoverEffectLeaseAcquisitionFailure(
          makeManagedStatusUpdate({ is_delivered: true }),
          {
            message: { consumerAssignmentEpoch: 15 },
            partition: 2,
            assertActive,
            reportProgress,
          },
          new CriticalRedisOperationError(
            'runtime_effect_lease_acquire',
            new AuxiliaryRuntimeLeaseRaceError()
          )
        )
      ).rejects.toMatchObject({
        name: 'CriticalRedisOperationError',
        operation: expect.stringContaining('runtime_lease_race_handoff'),
      });
      expect(reportProgress).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('does not hand off an unknown lease-acquisition failure as a runtime race', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer, messageStatusPendingService } = makeConsumer();

    try {
      await consumer.execute();
      const options = (consumer as any).runner.options;
      await expect(
        options.recoverEffectLeaseAcquisitionFailure(
          makeManagedStatusUpdate({ is_delivered: true }),
          {
            message: { consumerAssignmentEpoch: 15 },
            partition: 2,
            assertActive: jest.fn(),
            reportProgress: jest.fn(),
          },
          new CriticalRedisOperationError(
            'runtime_effect_lease_acquire',
            new Error('redis unavailable')
          )
        )
      ).resolves.toBe('retry');
      expect(
        messageStatusPendingService.reschedulePendingStatus
      ).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('does not start the Kafka consumer when Redis legacy cleanup is uncertain', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer, messageStatusPendingService } = makeConsumer();
    messageStatusPendingService.discardLegacyPendingStatuses.mockRejectedValue(
      new Error('redis unavailable')
    );

    try {
      await expect(consumer.execute()).rejects.toMatchObject({
        name: 'CriticalRedisOperationError',
        operation: expect.stringContaining('discard_legacy_pending'),
      });
      expect(start).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('does not synthesize the identity required for a portable terminal event', () => {
    const { consumer } = makeConsumer();
    const terminal: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      event_id: undefined,
      failed: true,
      message_id: 'internal-message-id',
      internal_message_id: 'internal-message-id',
      source_provider: 'baileys',
      terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
    };

    const parsed = (consumer as any).parseMessage(
      Buffer.from(JSON.stringify(terminal))
    ) as IMessageStatusUpdate;

    expect(parsed.event_id).toBeUndefined();
    expect((consumer as any).requiresRuntimeFence(parsed)).toBe(true);
  });

  it('keeps deterministic identity generation for an ordinary legacy status', () => {
    const { consumer } = makeConsumer();
    const ordinary: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_sent: true }),
      event_id: undefined,
    };

    const parsed = (consumer as any).parseMessage(
      Buffer.from(JSON.stringify(ordinary))
    ) as IMessageStatusUpdate;

    expect(parsed.event_id).toBe(buildMessageStatusEventId(ordinary));
  });

  it('propagates a runtime-fence Redis failure instead of classifying the event as stale', async () => {
    const { consumer, redis } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate(),
      source_provider: 'baileys',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
    };
    redis.get.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      (consumer as any).isRuntimeCurrent(data)
    ).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: expect.stringContaining('runtime_fence'),
    });
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'rebinds a durable %s status to the active generation without regressing its event identity',
    async (provider) => {
      const { consumer, messageStatusPendingService, messageStatusService } =
        makeConsumer();
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
            runtime_generation: 12,
            connection_epoch: `${provider}-epoch-12`,
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
      const status: IMessageStatusUpdate = {
        ...makeStatusUpdate({ is_delivered: true }),
        source_provider: provider,
        runtime_generation: 11,
        connection_epoch: `${provider}-epoch-11`,
      };
      status.event_id = buildMessageStatusEventId(status) ?? undefined;
      const stableEventId = status.event_id;
      messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue({
        message_id: 'internal-message-1',
      });

      await expect(
        (consumer as any).acquireStatusEffectLease(status)
      ).resolves.toBe(lease);
      await (consumer as any).processStatusUpdate(status, jest.fn(), true);

      expect(status).toMatchObject({
        event_id: stableEventId,
        account_id: 'acc-1',
        worker_id: 'worker-1',
        source_provider: provider,
        runtime_generation: 12,
        connection_epoch: `${provider}-epoch-12`,
        patch: { is_delivered: true },
      });
      expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(
        messageStatusService.updateSummaryByWhatsAppId
      ).toHaveBeenCalledWith(
        'acc-1',
        'msg-1',
        { is_sent: true, is_delivered: true },
        expect.any(Object),
        'worker-1',
        expect.any(Function)
      );
      expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: stableEventId,
          runtime_generation: 12,
          connection_epoch: `${provider}-epoch-12`,
        }),
        'internal-message-1'
      );
    }
  );

  it('fails closed for a forged managed status before current-scope capture', async () => {
    const { consumer } = makeConsumer();
    const runtimeFence = {
      viewAdmissionState: jest.fn(),
      acquireEffectLease: jest.fn(),
    };
    (consumer as any).runtimeFence = runtimeFence;
    const forged: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_sent: true }),
      event_id: 'forged-status-event',
      source_provider: 'baileys',
      runtime_generation: 4,
      connection_epoch: 'epoch-4',
    };

    await expect(
      (consumer as any).acquireStatusEffectLease(forged)
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
      detail: 'invalid_identity',
    });
    expect(runtimeFence.viewAdmissionState).not.toHaveBeenCalled();
  });

  it('classifies an unsupported-provider poison as terminal for runner offset advancement', async () => {
    const start = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockResolvedValue(undefined);
    const { consumer } = makeConsumer();
    const unsupported: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_sent: true }),
      source_provider: 'unsupported-provider' as never,
      runtime_generation: 4,
      connection_epoch: 'epoch-4',
    };
    unsupported.event_id = buildMessageStatusEventId(unsupported) ?? undefined;

    try {
      await consumer.execute();
      const options = (consumer as any).runner.options;
      let admissionError: unknown;
      try {
        await options.acquireEffectLease(unsupported, {});
      } catch (error) {
        admissionError = error;
      }

      expect(admissionError).toMatchObject({
        name: 'UnrecoverableAuxiliaryRuntimeEventError',
        detail: 'invalid_identity',
      });
      expect(options.classifyError(unsupported, {}, admissionError)).toBe(
        'terminal'
      );
    } finally {
      start.mockRestore();
      await consumer.close();
    }
  });

  it('rebinds a pending status to the current Kafka assignment before claiming it', () => {
    const { consumer } = makeConsumer();
    (consumer as any).consumerInstanceId = 'consumer-pod-new';
    const pending: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_seen: true }),
      source_provider: 'wwebjs',
      runtime_generation: 8,
      connection_epoch: 'old-epoch',
      consumer_assignment_owner: 'consumer-pod-old',
      consumer_assignment_epoch: 3,
      consumer_partition: 2,
    };
    pending.event_id = buildMessageStatusEventId(pending) ?? undefined;

    expect((consumer as any).pendingAssignmentDecision(pending)).toBe('claim');
    expect(pending.consumer_assignment_owner).toBe('consumer-pod-new');
    expect(pending.consumer_assignment_epoch).toBe(7);
    expect((consumer as any).isPendingAssignmentActive(pending)).toBe(true);
  });

  it('bounds a frozen runtime-fence read and leaves the status unconsumed', async () => {
    const previousTimeout = process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
    process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = '250';
    const { consumer, redis } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate(),
      source_provider: 'baileys',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
    };
    redis.get.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const startedAt = Date.now();

    try {
      await expect(
        (consumer as any).isRuntimeCurrent(data)
      ).rejects.toMatchObject({
        name: 'CriticalRedisOperationError',
        timeout: true,
      });
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
      } else {
        process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = previousTimeout;
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('propagates status-ledger Redis failures without mutating or rescheduling the message', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeStatusUpdate();
    messageStatusPendingService.isApplied.mockRejectedValueOnce(
      new Error('redis connection lost')
    );

    await expect(
      (consumer as any).processStatusUpdate(data)
    ).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: expect.stringContaining('status_is_applied'),
    });

    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.discardPendingStatusForEvent
    ).not.toHaveBeenCalled();
  });

  it('propagates Redis failures while checking or recording status idempotency', async () => {
    const { consumer, redis } = makeConsumer();
    const data = makeStatusUpdate();

    redis.exists.mockRejectedValueOnce(new Error('redis read failed'));
    await expect(
      (consumer as any).isAlreadyProcessed(data)
    ).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: expect.stringContaining('idempotency_exists'),
    });

    redis.setex.mockRejectedValueOnce(new Error('redis write failed'));
    await expect((consumer as any).markAsProcessed(data)).rejects.toMatchObject(
      {
        name: 'CriticalRedisOperationError',
        operation: expect.stringContaining('idempotency_set'),
      }
    );
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
      'status-update:v2:acc-1:worker-1:msg-1:event:status-event-1',
      30 * 24 * 60 * 60,
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

  it('routes a durable late provider failure through the failed status writer', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      failed: true,
      provider_error_code: 131047,
      provider_status_at: '2026-08-16T19:49:59.000Z',
    };
    messageStatusService.markMessageAsNotSentByWhatsAppId.mockResolvedValue({
      message_id: 'internal-message-id',
    });

    await (consumer as any).processStatusUpdate(data);

    expect(
      messageStatusService.markMessageAsNotSentByWhatsAppId
    ).toHaveBeenCalledWith(
      'acc-1',
      'msg-1',
      data.key,
      'worker-1',
      expect.any(Function),
      'failed',
      {
        errorCode: 131047,
        occurredAt: '2026-08-16T19:49:59.000Z',
      }
    );
    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      data,
      'internal-message-id'
    );
  });

  it('confirms a positive official-template provider status before applying the status ledger', async () => {
    const {
      consumer,
      messageStatusPendingService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({ is_sent: true }),
      message_id: 'wamid.provider-accepted',
    };
    const canonicalMessage = {
      message_id: 'internal-template-id',
      content: { type: 'official_template' },
      delivery_status: 'sent',
      summary: {
        is_sent: true,
        is_delivered: false,
        is_seen: false,
      },
    };
    messageStatusService.updateSummaryByWhatsAppId.mockResolvedValue(
      canonicalMessage
    );

    await (consumer as any).processStatusUpdate(data);

    expect(
      officialWindowService.recordProviderAcceptedMessage
    ).toHaveBeenCalledWith(canonicalMessage, 'wamid.provider-accepted');
    expect(
      officialWindowService.recordProviderAcceptedMessage.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      messageStatusPendingService.markApplied.mock.invocationCallOrder[0]
    );
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateUncertainForMessage
    ).not.toHaveBeenCalled();
  });

  it('clears an official-template window on the canonical failed outcome before applying the status ledger', async () => {
    const {
      consumer,
      messageStatusPendingService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      message_id: 'wamid.provider-failure',
      failed: true,
      provider_error_code: 132000,
    };
    const canonicalMessage = {
      message_id: 'internal-template-id',
      content: { type: 'official_template' },
      delivery_status: 'failed',
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
    };
    messageStatusService.markMessageAsNotSentByWhatsAppId.mockResolvedValue(
      canonicalMessage
    );

    await (consumer as any).processStatusUpdate(data);

    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).toHaveBeenCalledWith(canonicalMessage, 132000, 'wamid.provider-failure');
    expect(
      officialWindowService.recordTemplateUncertainForMessage
    ).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateFailureForMessage.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      messageStatusPendingService.markApplied.mock.invocationCallOrder[0]
    );
  });

  it('marks an official-template window uncertain for an ambiguous receipt even when the canonical message remains sent', async () => {
    const {
      consumer,
      messageStatusPendingService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      message_id: 'wamid.provider-uncertain',
      failed: true,
      ambiguous: true,
    };
    const canonicalMessage = {
      message_id: 'internal-template-id',
      content: { type: 'official_template' },
      delivery_status: 'sent',
      summary: {
        is_sent: true,
        is_delivered: false,
        is_seen: false,
      },
    };
    messageStatusService.markMessageAsNotSentByWhatsAppId.mockResolvedValue(
      canonicalMessage
    );

    await (consumer as any).processStatusUpdate(data);

    expect(
      officialWindowService.recordTemplateUncertainForMessage
    ).toHaveBeenCalledWith(canonicalMessage, 'wamid.provider-uncertain');
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateUncertainForMessage.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      messageStatusPendingService.markApplied.mock.invocationCallOrder[0]
    );
  });

  it.each([
    ['delivered', { is_sent: true, is_delivered: true, is_seen: false }],
    ['read', { is_sent: true, is_delivered: true, is_seen: true }],
  ])(
    'does not transition the official-template window for a stale failed receipt after canonical %s',
    async (deliveryStatus, summary) => {
      const { consumer, messageStatusService, officialWindowService } =
        makeConsumer();
      const data: IMessageStatusUpdate = {
        ...makeStatusUpdate({}),
        message_id: `wamid.stale-${deliveryStatus}`,
        failed: true,
        provider_error_code: 131047,
      };
      messageStatusService.markMessageAsNotSentByWhatsAppId.mockResolvedValue({
        message_id: 'internal-template-id',
        content: { type: 'official_template' },
        delivery_status: deliveryStatus,
        summary,
      });

      await (consumer as any).processStatusUpdate(data);

      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordTemplateUncertainForMessage
      ).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordProviderAcceptedMessage
      ).not.toHaveBeenCalled();
    }
  );

  it('reschedules the status instead of applying its ledger when official-window reconciliation fails', async () => {
    const {
      consumer,
      messageStatusPendingService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      message_id: 'wamid.window-retry',
      failed: true,
    };
    messageStatusService.markMessageAsNotSentByWhatsAppId.mockResolvedValue({
      message_id: 'internal-template-id',
      content: { type: 'official_template' },
      delivery_status: 'failed',
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
    });
    officialWindowService.recordTemplateFailureForMessage.mockRejectedValue(
      new Error('window unavailable')
    );

    await (consumer as any).processStatusUpdate(data);

    expect(messageStatusPendingService.markApplied).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'wamid.window-retry' }),
      { batchSize: 1, duration: expect.any(Number) },
      { incrementRetry: false }
    );
  });

  it('applies a durable pre-provider terminal failure by its internal message id', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      failed: true,
      internal_message_id: 'internal-message-id',
      message_id: 'internal-message-id',
      source_provider: 'baileys',
      terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
    };
    data.event_id = buildMessageStatusEventId(data) ?? undefined;
    messageStatusService.markMessageAsNotSent.mockResolvedValue({
      message_id: 'internal-message-id',
    });

    await (consumer as any).processStatusUpdate(data);

    expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
      'acc-1',
      'internal-message-id',
      expect.any(Function),
      'failed'
    );
    expect(
      messageStatusService.markMessageAsNotSentByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      data,
      'internal-message-id'
    );
  });

  it('applies an exact ambiguous terminal outcome by its internal message id', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      failed: true,
      ambiguous: true,
      internal_message_id: 'internal-ambiguous-id',
      message_id: 'internal-ambiguous-id',
      source_provider: 'baileys',
      terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
    };
    data.event_id = buildMessageStatusEventId(data) ?? undefined;
    messageStatusService.markMessageAsNotSent.mockResolvedValue({
      message_id: 'internal-ambiguous-id',
      is_sent: true,
    });

    await (consumer as any).processStatusUpdate(data);

    expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
      'acc-1',
      'internal-ambiguous-id',
      expect.any(Function),
      'ambiguous'
    );
    expect(
      messageStatusService.markMessageAsNotSentByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      data,
      'internal-ambiguous-id'
    );
  });

  it('bypasses the runtime fence only for the explicit pre-provider terminal schema', () => {
    const { consumer } = makeConsumer();
    const terminal: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      failed: true,
      message_id: 'internal-message-id',
      internal_message_id: 'internal-message-id',
      source_provider: 'wwebjs',
      terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
    };
    terminal.event_id = buildMessageStatusEventId(terminal) ?? undefined;

    expect((consumer as any).requiresRuntimeFence(terminal)).toBe(false);
    expect(
      (consumer as any).requiresRuntimeFence({
        ...terminal,
        source_provider: 'whatsmeow',
      })
    ).toBe(false);
    expect(
      (consumer as any).requiresRuntimeFence({
        ...terminal,
        failed: false,
        patch: { is_sent: true },
      })
    ).toBe(true);
    expect(
      (consumer as any).requiresRuntimeFence({
        ...terminal,
        terminal_failure_schema: undefined,
      })
    ).toBe(true);
    expect(
      (consumer as any).requiresRuntimeFence({
        ...terminal,
        source_provider: 'official_whatsapp',
      })
    ).toBe(false);
    expect(
      (consumer as any).requiresRuntimeFence({
        ...terminal,
        event_id: 'forged-terminal-event-id',
      })
    ).toBe(true);

    for (const source_provider of [
      'baileys',
      'wwebjs',
      'whatsmeow',
      'official_whatsapp',
    ] as const) {
      const ambiguous: IMessageStatusUpdate = {
        ...terminal,
        event_id: undefined,
        source_provider,
        terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
        ambiguous: true,
      };
      ambiguous.event_id = buildMessageStatusEventId(ambiguous) ?? undefined;
      expect((consumer as any).requiresRuntimeFence(ambiguous)).toBe(false);
      expect(
        (consumer as any).requiresRuntimeFence({
          ...ambiguous,
          event_id: `forged-${source_provider}`,
        })
      ).toBe(true);
      expect(
        (consumer as any).requiresRuntimeFence({
          ...ambiguous,
          ambiguous: false,
        })
      ).toBe(true);
    }
  });

  it('keeps a forged terminal event id behind the runtime fence and rejects it when stale', async () => {
    const { consumer } = makeConsumer();
    const forged: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      event_id: 'forged-terminal-event-id',
      failed: true,
      ambiguous: true,
      message_id: 'internal-forged-id',
      internal_message_id: 'internal-forged-id',
      source_provider: 'baileys',
      terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
    };
    const isCurrent = jest
      .spyOn((consumer as any).runtimeFence, 'isCurrent')
      .mockResolvedValue(false);

    await expect((consumer as any).isRuntimeCurrent(forged)).resolves.toBe(
      false
    );
    expect(isCurrent).toHaveBeenCalledWith(forged);
  });

  it('reconciles due pending statuses internally without publishing to Kafka', async () => {
    const {
      consumer,
      kafkaServiceQueueService,
      messageStatusPendingService,
      messageStatusService,
    } = makeConsumer();
    const data = makeManagedStatusUpdate({ is_seen: true });
    configureActiveRuntime(consumer);

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
      data.key,
      'worker-1',
      expect.any(Function)
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
    expect(kafkaServiceQueueService.updateMessageStatus).toHaveBeenCalled();
  });

  it('runs the pending-status recovery worker as a single flight', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const { consumer } = makeConsumer();
    let resolveFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const processDuePendingStatuses = jest
      .spyOn(consumer as any, 'processDuePendingStatuses')
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue(undefined);

    try {
      (consumer as any).isRunning = true;
      (consumer as any).startMissingStatusRetryWorker();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(processDuePendingStatuses).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(processDuePendingStatuses).toHaveBeenCalledTimes(1);

      resolveFirst?.();
      await firstRun;
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1_000);

      expect(processDuePendingStatuses).toHaveBeenCalledTimes(2);
    } finally {
      (consumer as any).isRunning = false;
      if ((consumer as any).missingStatusRetryTimer) {
        clearTimeout((consumer as any).missingStatusRetryTimer);
      }
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  it('does not abandon or overlap a slow Redis pending-claim sweep', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const { consumer, messageStatusPendingService } = makeConsumer();
    let resolveClaim: ((value: IMessageStatusUpdate[]) => void) | undefined;
    const slowClaim = new Promise<IMessageStatusUpdate[]>((resolve) => {
      resolveClaim = resolve;
    });
    messageStatusPendingService.claimDuePendingStatuses.mockReturnValue(
      slowClaim
    );

    try {
      (consumer as any).isRunning = true;
      (consumer as any).startMissingStatusRetryWorker();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(
        messageStatusPendingService.claimDuePendingStatuses
      ).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(
        messageStatusPendingService.claimDuePendingStatuses
      ).toHaveBeenCalledTimes(1);

      resolveClaim?.([]);
      await slowClaim;
      await jest.advanceTimersByTimeAsync(0);
    } finally {
      (consumer as any).isRunning = false;
      resolveClaim?.([]);
      if ((consumer as any).missingStatusRetryTimer) {
        clearTimeout((consumer as any).missingStatusRetryTimer);
      }
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  it('backs off the pending-status recovery worker after Redis failures', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { consumer } = makeConsumer();
    const processDuePendingStatuses = jest
      .spyOn(consumer as any, 'processDuePendingStatuses')
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValue(undefined);

    try {
      (consumer as any).isRunning = true;
      (consumer as any).startMissingStatusRetryWorker();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(processDuePendingStatuses).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1_999);
      expect(processDuePendingStatuses).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(processDuePendingStatuses).toHaveBeenCalledTimes(2);
    } finally {
      (consumer as any).isRunning = false;
      if ((consumer as any).missingStatusRetryTimer) {
        clearTimeout((consumer as any).missingStatusRetryTimer);
      }
      error.mockRestore();
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  it('clears a due pending status when the ledger already covers it', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeManagedStatusUpdate({ is_delivered: true });
    configureActiveRuntime(consumer);

    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusPendingService.isApplied.mockResolvedValue(true);

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.discardClaimedPendingStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-1',
        message_id: 'msg-1',
        worker_id: 'worker-1',
      })
    );
  });

  it('reschedules a due pending status when the target message is still missing', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeManagedStatusUpdate({ is_delivered: true });
    configureActiveRuntime(consumer);

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

  it('stops a redrive holder before downstream effects after its claim lease is lost', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeManagedStatusUpdate({ is_delivered: true });
    configureActiveRuntime(consumer);
    let claimActive = true;
    const downstreamEffect = jest.fn();
    const leaseLost = new Error('message_status_pending_claim_lease_lost');
    leaseLost.name = 'MessageStatusPendingClaimLeaseLostError';

    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusPendingService.withClaimHeartbeat.mockImplementation(
      async (
        _data: IMessageStatusUpdate,
        callback: (assertClaimActive: () => Promise<void>) => Promise<void>
      ) =>
        callback(async () => {
          if (!claimActive) {
            throw leaseLost;
          }
        })
    );
    messageStatusService.updateSummaryByWhatsAppId.mockImplementation(
      async (
        _accountId: string,
        _messageId: string,
        _patch: IMessageStatusUpdate['patch'],
        _key: IMessageStatusUpdate['key'],
        _workerId: string,
        assertActive: () => Promise<void>
      ) => {
        await assertActive();
        claimActive = false;
        await assertActive();
        downstreamEffect();
        return { message_id: 'internal-message-id' };
      }
    );

    await (consumer as any).processDuePendingStatuses();

    expect(downstreamEffect).not.toHaveBeenCalled();
    expect(messageStatusPendingService.markApplied).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.discardClaimedPendingStatus
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).not.toHaveBeenCalled();
  });

  it('recognizes a pending claim lease lost through a critical Redis wrapper', () => {
    const { consumer } = makeConsumer();
    const leaseLost = new Error('message_status_pending_claim_lease_lost');
    leaseLost.name = 'MessageStatusPendingClaimLeaseLostError';

    expect(
      (consumer as any).isPendingClaimLeaseLost(
        new CriticalRedisOperationError(
          'message_status_requeue_pending_after_runtime_admission',
          leaseLost
        )
      )
    ).toBe(true);
  });

  it('requeues an ordinary pending retry from a revoked assignment without incrementing retry', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeStatusUpdate();
    (consumer as any).consumer.__isAssignmentEpochActive.mockReturnValue(false);
    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusPendingService.discardClaimedPendingStatus
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).toHaveBeenCalledWith(
      data,
      { batchSize: 1, duration: 0 },
      { incrementRetry: false }
    );
    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
    expect(
      messageStatusService.markMessageAsNotSentByWhatsAppId
    ).not.toHaveBeenCalled();
  });

  it('requeues a claim revoked during mutation and lets the new assignment owner apply it', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeManagedStatusUpdate({ is_delivered: true }, 'wwebjs');
    configureActiveRuntime(consumer, 'wwebjs');
    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);
    messageStatusService.updateSummaryByWhatsAppId
      .mockImplementationOnce(
        async (
          _accountId: string,
          _messageId: string,
          _patch: IMessageStatusUpdate['patch'],
          _key: IMessageStatusUpdate['key'],
          _workerId: string,
          assertActive: () => Promise<void>
        ) => {
          (consumer as any).consumer.__isAssignmentEpochActive.mockReturnValue(
            false
          );
          await assertActive();
          return { message_id: 'must-not-apply' };
        }
      )
      .mockResolvedValueOnce({ message_id: 'internal-message-id' });

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: data.event_id,
        runtime_generation: 8,
        connection_epoch: 'wwebjs-epoch-8',
      }),
      { batchSize: 1, duration: 0 },
      { incrementRetry: false }
    );
    expect(
      messageStatusPendingService.discardClaimedPendingStatus
    ).not.toHaveBeenCalled();
    expect(messageStatusPendingService.markApplied).not.toHaveBeenCalled();

    (consumer as any).consumerInstanceId = 'consumer-pod-new';
    (consumer as any).consumer.__health.mockReturnValue({
      assignment_epoch: 8,
      assignments: [{ topic: 'update.message.status', partition: 2 }],
    });
    (consumer as any).consumer.__isAssignmentEpochActive.mockReturnValue(true);
    expect((consumer as any).pendingAssignmentDecision(data)).toBe('claim');
    await (consumer as any).processDuePendingStatuses();

    expect(data).toMatchObject({
      consumer_assignment_owner: 'consumer-pod-new',
      consumer_assignment_epoch: 8,
      runtime_generation: 8,
      connection_epoch: 'wwebjs-epoch-8',
    });
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: data.event_id,
        consumer_assignment_owner: 'consumer-pod-new',
        consumer_assignment_epoch: 8,
      }),
      'internal-message-id'
    );
  });

  it('carries a canonical terminal failure across a rebalance and applies it exactly once after the target appears', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const terminal: IMessageStatusUpdate = {
      ...makeStatusUpdate({}),
      failed: true,
      message_id: 'internal-portable-id',
      internal_message_id: 'internal-portable-id',
      source_provider: 'baileys',
      terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
      consumer_assignment_owner: 'consumer-pod-old',
      consumer_assignment_epoch: 3,
    };
    terminal.event_id = buildMessageStatusEventId(terminal) ?? undefined;
    messageStatusService.markMessageAsNotSent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ message_id: 'internal-portable-id' });

    await (consumer as any).processStatusUpdate(terminal);
    expect(
      messageStatusPendingService.deferMissingStatusUpdate
    ).toHaveBeenCalledTimes(1);

    (consumer as any).consumerInstanceId = 'consumer-pod-new';
    (consumer as any).consumer.__isAssignmentEpochActive.mockReturnValue(false);
    const pending = {
      ...messageStatusPendingService.deferMissingStatusUpdate.mock.calls[0][0],
      pending_claim_owner: (consumer as any).pendingClaimOwnerId,
      pending_claim_token: JSON.stringify({
        owner_id: (consumer as any).pendingClaimOwnerId,
        token: 'portable-claim-token',
      }),
      pending_retry_version: 'portable-retry-version',
    } as IMessageStatusUpdate;
    messageStatusPendingService.claimDuePendingStatuses.mockImplementation(
      async (options: {
        decideClaim: (
          data: IMessageStatusUpdate
        ) => 'claim' | 'discard' | 'ignore';
      }) => {
        expect(options.decideClaim(pending)).toBe('claim');
        return [pending];
      }
    );
    messageStatusPendingService.isApplied
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await (consumer as any).processDuePendingStatuses();
    await (consumer as any).processDuePendingStatuses();

    expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledTimes(2);
    expect(messageStatusService.markMessageAsNotSent).toHaveBeenLastCalledWith(
      'acc-1',
      'internal-portable-id',
      expect.any(Function),
      'failed'
    );
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledTimes(1);
    expect(messageStatusPendingService.markApplied).toHaveBeenCalledWith(
      pending,
      'internal-portable-id'
    );
  });

  it('rebinds a retry from another consumer instance only when this consumer owns its partition', async () => {
    const { consumer, messageStatusPendingService } = makeConsumer();

    await (consumer as any).processDuePendingStatuses();

    const options =
      messageStatusPendingService.claimDuePendingStatuses.mock.calls[0][0];
    const previousOwner = {
      ...makeManagedStatusUpdate({ is_delivered: true }),
      consumer_assignment_owner: 'consumer-pod-b',
    };
    expect(options.decideClaim(previousOwner)).toBe('claim');
    expect(previousOwner).toMatchObject({
      consumer_assignment_owner: 'consumer-pod-a',
      consumer_assignment_epoch: 7,
      consumer_partition: 2,
    });
    expect(
      options.decideClaim({
        ...makeManagedStatusUpdate({ is_delivered: true }),
        event_id: 'forged-status-event',
      })
    ).toBe('discard');

    (consumer as any).consumer.__health.mockReturnValue({
      assignment_epoch: 8,
      assignments: [{ topic: 'update.message.status', partition: 3 }],
    });
    expect(
      options.decideClaim({
        ...makeManagedStatusUpdate({ is_delivered: true }),
        consumer_assignment_owner: 'consumer-pod-b',
      })
    ).toBe('ignore');
  });

  it('requeues a pending retry immediately while the replacement runtime is activating', async () => {
    const { consumer, messageStatusPendingService, messageStatusService } =
      makeConsumer();
    const data = makeManagedStatusUpdate({ is_delivered: true }, 'wwebjs');
    (consumer as any).runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'activating' as const,
      })),
      acquireEffectLease: jest.fn(),
    };
    messageStatusPendingService.claimDuePendingStatuses.mockResolvedValue([
      data,
    ]);

    await (consumer as any).processDuePendingStatuses();

    expect(
      messageStatusPendingService.discardClaimedPendingStatus
    ).not.toHaveBeenCalled();
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).toHaveBeenCalledWith(
      data,
      { batchSize: 1, duration: 0 },
      { incrementRetry: false }
    );
    expect(
      messageStatusService.updateSummaryByWhatsAppId
    ).not.toHaveBeenCalled();
  });

  it('does not persist a retry when the provider runtime becomes stale after a failure', async () => {
    const {
      consumer,
      redis,
      messageStatusPendingService,
      messageStatusService,
    } = makeConsumer();
    const data: IMessageStatusUpdate = {
      ...makeStatusUpdate(),
      source_provider: 'wwebjs',
      runtime_generation: 8,
      connection_epoch: 'connection-old',
    };
    messageStatusService.updateSummaryByWhatsAppId.mockRejectedValue(
      new Error('elasticsearch unavailable')
    );
    redis.get.mockResolvedValue(
      JSON.stringify({
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
        runtime_generation: 8,
        connection_epoch: 'connection-current',
        activated_at: Date.now(),
      })
    );

    await (consumer as any).processStatusUpdate(data);

    expect(
      messageStatusPendingService.discardPendingStatusForEvent
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-1',
        message_id: 'msg-1',
        worker_id: 'worker-1',
      })
    );
    expect(
      messageStatusPendingService.reschedulePendingStatus
    ).not.toHaveBeenCalled();
  });
});
