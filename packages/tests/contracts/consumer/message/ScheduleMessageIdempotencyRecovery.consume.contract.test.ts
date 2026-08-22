import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));
jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-1',
    baileysWorkerId: 'worker-1',
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-1',
    wwebjsWorkerId: 'worker-1',
  },
}));
jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, callback: () => Promise<unknown>) =>
      callback()
  ),
}));
jest.mock('@core/services/baileys/methods/messageText.service', () => ({
  BaileysMessageTextService: class BaileysMessageTextService {},
}));
jest.mock('@core/services/baileys/methods/messageMedia.service', () => ({
  BaileysMessageMediaService: class BaileysMessageMediaService {},
}));
jest.mock('@core/services/baileys/methods/phoneValidation.service', () => ({
  BaileysPhoneValidationService: class BaileysPhoneValidationService {},
}));
jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));
jest.mock('@core/services/wwebjs/methods/messageText.service', () => ({
  WwebjsMessageTextService: class WwebjsMessageTextService {},
}));
jest.mock('@core/services/wwebjs/methods/messageMedia.service', () => ({
  WwebjsMessageMediaService: class WwebjsMessageMediaService {},
}));
jest.mock('@core/services/wwebjs/methods/phoneValidation.service', () => ({
  WwebjsPhoneValidationService: class WwebjsPhoneValidationService {},
}));
jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

import { MessageUpdatePublishFailedError } from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ScheduleMessageConsume } from '@core/consumer/schedule/ScheduleMessage.consume';
import { ScheduleMessageWwebjsConsume } from '@core/consumer/schedule/ScheduleMessageWwebjs.consume';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { ScheduleMessageInFlightLeaseUnavailableError } from '@core/services/scheduleStatusCoordination.service';
import { ProviderInvocationInFlightError } from '@core/common/functions/providerInvocationSingleFlight';
import { buildScheduleSendAmbiguousRecovery } from '@core/common/functions/outboundAuxiliarySendRecovery';
import { ProviderAuxiliaryInvocationTimeoutError } from '@core/common/functions/providerAuxiliaryInvocation';
import {
  MediaDownloadHttpError,
  MediaDownloadInvalidUrlError,
  MediaDownloadNetworkError,
  MediaDownloadSizeLimitError,
  MediaDownloadTimeoutError,
} from '@core/common/functions/downloadMediaBuffer';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ensureMessageUpdateIdentity } from '@core/common/functions/messageUpdateIdentity';
import { withLock } from '@core/common/functions/withLock';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';

describe('schedule message succeeded-ledger recovery', () => {
  const providerCases = [
    ['Baileys', ScheduleMessageConsume, 'baileysMessageTextService', 'baileys'],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsMessageTextService',
      'wwebjs',
    ],
  ] as const;
  const uncertainPersistenceCases = providerCases.flatMap((providerCase) =>
    (['error', 'owner_mismatch', 'not_found'] as const).map(
      (transitionStatus) => [...providerCase, transitionStatus] as const
    )
  );
  const recoverableDuplicateCases = providerCases.map(
    (providerCase) => [...providerCase, 'ambiguous'] as const
  );
  const legacyDuplicateCases = providerCases.map(
    (providerCase) =>
      [...providerCase, 'ambiguous', { malformed: true }] as const
  );
  const legacyRecoveryFailureCases = providerCases.flatMap((providerCase) =>
    (['error', 'invalid_state', 'not_found'] as const).map(
      (transitionStatus) => [...providerCase, transitionStatus] as const
    )
  );

  beforeEach(() => {
    const coordination = {
      setMessageOperationalState: jest.fn(async () => 'transitioned'),
      setMessageOperationalStateFromLedger: jest.fn(async () => 'transitioned'),
      withMessageInFlight: jest.fn(
        async (
          _input: unknown,
          callback: (assertOwned: () => Promise<void>) => Promise<unknown>
        ) => callback(jest.fn(async () => undefined))
      ),
    };
    (
      ScheduleMessageConsume.prototype as any
    ).scheduleStatusCoordinationService = coordination;
    (
      ScheduleMessageWwebjsConsume.prototype as any
    ).scheduleStatusCoordinationService = coordination;
    (ScheduleMessageConsume.prototype as any).baileysIncomingMessageService = {
      captureActiveConnectionScope: jest.fn(async () => ({
        worker_id: 'worker-1',
        source_provider: 'baileys',
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      })),
    };
    (
      ScheduleMessageWwebjsConsume.prototype as any
    ).wwebjsIncomingMessageService = {
      captureActiveConnectionScope: jest.fn(async () => ({
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      })),
    };
  });

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileys'],
    ['WWebJS', ScheduleMessageWwebjsConsume, 'wwebjs'],
  ])(
    'keeps message_id as the %s outbound identity across distinct attempts',
    async (_providerName, Consumer, sourceProvider) => {
      const claimOperation = jest.fn(async (input) => ({
        status: 'acquired',
        state: 'reserved',
        accountId: input.accountId,
        operationType: input.operationType,
        operationId: input.operationId,
        key: 'schedule-key',
        owner: 'owner-1',
        result: null,
      }));
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = { claimOperation };
      const message = {
        message_id: 'stable-schedule-message-1',
        chat_id: '5511999999999@s.whatsapp.net',
        hash: 'logical-client-hash-that-must-not-fence-schedule-retries',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'same content' },
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };

      await consumer.claimMessageSend(
        {
          schedule_id: 'schedule-1',
          contact_id: 'contact-1',
          attempt_id: 'attempt-1',
          message,
        },
        connectionScope,
        11
      );
      await consumer.claimMessageSend(
        {
          schedule_id: 'schedule-1',
          contact_id: 'contact-1',
          attempt_id: 'attempt-2',
          message,
        },
        connectionScope,
        11
      );

      expect(claimOperation).toHaveBeenCalledTimes(2);
      expect(claimOperation.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          operationType: 'schedule',
          operationId: message.message_id,
        })
      );
      expect(claimOperation.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          operationType: 'schedule',
          operationId: message.message_id,
        })
      );
      expect(claimOperation.mock.calls[0][0].meta).toEqual(
        claimOperation.mock.calls[1][0].meta
      );
      expect(claimOperation.mock.calls[0][0].meta).not.toHaveProperty(
        'attempt_id'
      );
      expect(claimOperation.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          runtimeFenceKey: 'whatsapp:runtime-fence:v1:worker-1',
          meta: expect.objectContaining({
            runtime_generation: 7,
            connection_epoch: 'connection-7',
            consumer_assignment_epoch: 11,
          }),
        })
      );
    }
  );

  it.each(providerCases)(
    'does not let a %s replacement attempt call the provider while the current reserved owner is still active',
    async (providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-reserved-current-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-reserved-current',
        attempt_id: 'attempt-replacement',
        contact_id: 'contact-reserved-current',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-current',
        connection_sequence: 1,
        activation_order: 1,
        activated_at: Date.now(),
      };
      const inspectOperation = jest.fn(async () => ({
        status: 'duplicate',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-reserved-current-key',
        owner: null,
        result: null,
      }));
      const claimOperation = jest.fn(async () => ({
        status: 'duplicate',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-reserved-current-key',
        owner: null,
        result: null,
      }));
      const adoptMessageAttemptFromLedgerReservation = jest.fn();
      const withMessageInFlight = jest.fn();
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = {
        inspectOperation,
        claimOperation,
      };
      consumer.scheduleStatusCoordinationService = {
        adoptMessageAttemptFromLedgerReservation,
        withMessageInFlight,
      };
      const incomingProperty =
        providerName === 'Baileys'
          ? 'baileysIncomingMessageService'
          : 'wwebjsIncomingMessageService';
      consumer[incomingProperty] = {
        captureActiveConnectionScope: jest.fn(async () => connectionScope),
      };
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage(
          'worker-1',
          payload,
          () => undefined,
          23
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(claimOperation).toHaveBeenCalledTimes(1);
      expect(claimOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeFenceKey: 'whatsapp:runtime-fence:v1:worker-1',
          meta: expect.objectContaining({
            runtime_generation: 7,
            connection_epoch: 'connection-current',
            consumer_assignment_epoch: 23,
          }),
        })
      );
      expect(adoptMessageAttemptFromLedgerReservation).not.toHaveBeenCalled();
      expect(withMessageInFlight).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'has the fenced %s runtime claim the provider ledger before adopting a divergent attempt',
    async (providerName, Consumer, _textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-reserved-takeover-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-reserved-takeover',
        attempt_id: 'attempt-replacement',
        contact_id: 'contact-reserved-takeover',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 8,
        connection_epoch: 'connection-replacement',
        connection_sequence: 2,
        activation_order: 2,
        activated_at: Date.now(),
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-reserved-takeover-key',
        owner: 'replacement-owner',
        result: null,
      } as const;
      const inspectOperation = jest.fn(async () => ({
        status: 'not_found',
        state: null,
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: claim.key,
        owner: null,
        result: null,
      }));
      const claimOperation = jest.fn(async () => claim);
      const markProviderInvoked = jest.fn(async () => 'transitioned');
      const releaseReservation = jest.fn(async () => 'transitioned');
      const adoptMessageAttemptFromLedgerReservation = jest.fn(
        async () => 'transitioned'
      );
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const withMessageInFlight = jest.fn(
        async (
          _input: unknown,
          callback: (assertOwned: () => Promise<void>) => Promise<unknown>
        ) => callback(jest.fn(async () => undefined))
      );
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        isCurrent: jest.fn(async () => true),
      };
      consumer.messageSendIdempotencyService = {
        inspectOperation,
        claimOperation,
        markProviderInvoked,
        releaseReservation,
      };
      consumer.scheduleStatusCoordinationService = {
        adoptMessageAttemptFromLedgerReservation,
        setMessageOperationalState,
        withMessageInFlight,
      };
      const incomingProperty =
        providerName === 'Baileys'
          ? 'baileysIncomingMessageService'
          : 'wwebjsIncomingMessageService';
      consumer[incomingProperty] = {
        captureActiveConnectionScope: jest.fn(async () => connectionScope),
      };
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(message.message_id);
        providerCall();
        consumer.activeSendClaims.delete(message.message_id);
      });

      await expect(
        consumer.processScheduleMessage(
          'worker-1',
          payload,
          () => undefined,
          24
        )
      ).resolves.toBeUndefined();

      expect(claimOperation).toHaveBeenCalledTimes(1);
      expect(adoptMessageAttemptFromLedgerReservation).toHaveBeenCalledWith({
        scheduleId: payload.schedule_id,
        accountId: 'account-1',
        workerId: 'worker-1',
        messageId: message.message_id,
        attemptId: payload.attempt_id,
        ledgerOperationId: message.message_id,
        ledgerReservationOwner: claim.owner,
      });
      expect(withMessageInFlight).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
          attemptId: payload.attempt_id,
        }),
        expect.any(Function)
      );
      expect(markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(releaseReservation).not.toHaveBeenCalled();
    }
  );

  it.each(uncertainPersistenceCases)(
    'keeps a %s schedule post-provider uncertain transition uncommitted after exactly one provider call',
    async (
      _providerName,
      Consumer,
      textServiceProperty,
      sourceProvider,
      transitionStatus
    ) => {
      const providerError = new Error('provider_ack_unknown');
      const message = {
        message_id: `scheduled-${transitionStatus}-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-persistence',
        attempt_id: 'attempt-persistence',
        contact_id: 'contact-persistence',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-persistence',
        result: null,
      };
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _quoted: unknown,
          beforeProviderSend: () => Promise<void>
        ) => {
          await beforeProviderSend();
          providerCall();
          throw providerError;
        }
      );
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => transitionStatus),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState: jest.fn(async () => 'transitioned'),
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.resolveValidatedJid = jest.fn(
        async () => '5511999999999@s.whatsapp.net'
      );
      consumer[textServiceProperty] = { sendText };
      consumer.sendSendLog = jest.fn();
      consumer.sendStatusUpdateBestEffort = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        claim,
        providerError,
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          provider: sourceProvider,
          operation_id: message.message_id,
        })
      );
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'reconciles a terminal failed %s duplicate without invoking the provider',
    async (_providerName, Consumer, _textServiceProperty, sourceProvider) => {
      const message = {
        message_id: 'scheduled-terminal-failed',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-terminal',
        attempt_id: 'attempt-terminal',
        contact_id: 'contact-terminal',
        account_id: 'account-1',
        message,
      };
      const setMessageOperationalStateFromLedger = jest.fn(
        async () => 'transitioned'
      );
      const send = jest.fn(async () => undefined);
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalStateFromLedger,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.runtimeFence = { isCurrent: jest.fn(async () => true) };
      consumer.streamProducerService = { send };
      consumer.kafkaServiceQueueService = {
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'duplicate',
        state: 'failed',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'scheduled-terminal-failed-key',
        owner: null,
        result: null,
      }));
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(setMessageOperationalStateFromLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
          attemptId: payload.attempt_id,
          ledgerOperationId: message.message_id,
        }),
        'pre_provider_failed'
      );
      expect(send).toHaveBeenCalledWith(
        'schedule.status.update',
        expect.objectContaining({
          schedule_id: payload.schedule_id,
          contact_id: payload.contact_id,
          message_id: message.message_id,
          source_provider: sourceProvider,
          status: EScheduleStatus.failed,
        }),
        `${payload.schedule_id}:${payload.contact_id}:${message.message_id}`,
        undefined,
        expect.any(Function)
      );
    }
  );

  it.each(providerCases)(
    'recovers a crashed %s permanent-failure Kafka publication immediately from the failed ledger without provider replay',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-failed-kafka-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: null,
      };
      const payload = {
        schedule_id: 'schedule-failed-kafka',
        attempt_id: 'attempt-failed-kafka',
        contact_id: 'contact-failed-kafka',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-failed-kafka',
        result: null,
      };
      const failedInspection = {
        ...acquiredClaim,
        status: 'duplicate',
        state: 'failed',
        owner: null,
      };
      const send = jest
        .fn<Promise<void>, unknown[]>()
        .mockRejectedValueOnce(new Error('schedule status Kafka unavailable'))
        .mockResolvedValue(undefined);
      const markFailed = jest.fn(async () => 'transitioned');
      const idempotency: Record<string, unknown> = {
        markFailed,
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.providerInvocationTransitionUncertainClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.runtimeFence = { isCurrent: jest.fn(async () => true) };
      consumer.streamProducerService = { send };
      consumer.kafkaServiceQueueService = {
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState: jest.fn(async () => 'transitioned'),
        setMessageOperationalStateFromLedger: jest.fn(
          async () => 'transitioned'
        ),
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => acquiredClaim);
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn(async () => {
        throw new Error('Message type is required');
      });

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      idempotency.inspectOperation = jest.fn(async () => failedInspection);
      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledTimes(1);
      expect(consumer.claimMessageSend).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual(
        expect.objectContaining({ status: EScheduleStatus.failed })
      );
      expect(send.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          status: EScheduleStatus.failed,
          source_provider: sourceProvider,
        })
      );
    }
  );

  it.each(recoverableDuplicateCases)(
    'recovers a crashed %s schedule boundary without invoking the provider twice or leaving the attempt pending',
    async (
      _providerName,
      Consumer,
      textServiceProperty,
      sourceProvider,
      duplicateState
    ) => {
      const message = {
        message_id: `scheduled-crash-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-crash',
        attempt_id: 'attempt-crash',
        contact_id: 'contact-crash',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-crash',
        result: null,
      };
      let providerBoundaryRecovery: unknown = null;
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _quoted: unknown,
          beforeProviderSend: () => Promise<void>
        ) => {
          await beforeProviderSend();
          providerCall();
          throw new Error('worker_crashed_after_provider');
        }
      );
      const idempotency = {
        markProviderInvoked: jest.fn(
          async (_claim: unknown, recovery: unknown) => {
            providerBoundaryRecovery = recovery;
            return 'transitioned';
          }
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'error'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(claim)
        .mockImplementationOnce(async () => ({
          ...claim,
          status: 'duplicate',
          state: duplicateState,
          owner: null,
          result: providerBoundaryRecovery,
        }));
      consumer.resolveValidatedJid = jest.fn(
        async () => '5511999999999@s.whatsapp.net'
      );
      consumer[textServiceProperty] = { sendText };
      consumer.sendSendLog = jest.fn();
      consumer.sendStatusUpdateBestEffort = jest.fn();
      const redeliveredPayload = {
        ...payload,
        attempt_id: 'attempt-recovered-after-crash',
      };

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.processScheduleMessage('worker-1', redeliveredPayload)
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledTimes(1);
      expect(setMessageOperationalState).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
          attemptId: redeliveredPayload.attempt_id,
        }),
        'ambiguous'
      );
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
      expect(providerBoundaryRecovery).toEqual(
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          operation_id: message.message_id,
        })
      );
    }
  );

  it.each(providerCases)(
    'recovers a ledger-proven %s provider boundary before a divergent attempt lease and never invokes the provider',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-prelease-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-prelease',
        attempt_id: 'attempt-replacement',
        contact_id: 'contact-prelease',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const recovery = buildScheduleSendAmbiguousRecovery({
        provider: sourceProvider,
        operationId: message.message_id,
        scheduleId: payload.schedule_id,
        contactId: payload.contact_id,
        messageId: message.message_id,
        attemptId: 'attempt-original',
        accountId: 'account-1',
        workerId: 'worker-1',
      });
      const inspection = {
        status: 'duplicate',
        state: 'ambiguous',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `schedule-prelease-${sourceProvider}`,
        owner: null,
        result: recovery,
      } as const;
      const inspectOperation = jest.fn(async () => inspection);
      const claimOperation = jest.fn();
      const setMessageOperationalStateFromLedger = jest.fn(
        async () => 'transitioned'
      );
      const withMessageInFlight = jest.fn(async () => {
        throw new Error('attempt lease must not be entered');
      });
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeScheduleMessages = new Map();
      consumer.messageSendIdempotencyService = {
        inspectOperation,
        claimOperation,
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalStateFromLedger,
        withMessageInFlight,
      };
      consumer[textServiceProperty] = { sendText };

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(inspectOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'schedule',
          operationId: message.message_id,
          compatibleLegacyMetaKeys: [
            'attempt_id',
            'runtime_generation',
            'connection_epoch',
            'consumer_assignment_epoch',
          ],
          meta: expect.not.objectContaining({
            attempt_id: expect.anything(),
          }),
        })
      );
      expect(setMessageOperationalStateFromLedger).toHaveBeenCalledWith(
        {
          scheduleId: payload.schedule_id,
          accountId: 'account-1',
          workerId: 'worker-1',
          messageId: message.message_id,
          attemptId: payload.attempt_id,
          ledgerOperationId: message.message_id,
        },
        'ambiguous'
      );
      expect(withMessageInFlight).not.toHaveBeenCalled();
      expect(claimOperation).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'keeps a live ledger-proven %s provider invocation uncommitted before the attempt lease',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-live-prelease-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-live-prelease',
        attempt_id: 'attempt-live',
        contact_id: 'contact-live',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const inspectOperation = jest.fn(async () => ({
        status: 'duplicate',
        state: 'provider_invoked',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: null,
        result: null,
      }));
      const withMessageInFlight = jest.fn();
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeScheduleMessages = new Map();
      consumer.messageSendIdempotencyService = { inspectOperation };
      consumer.scheduleStatusCoordinationService = { withMessageInFlight };
      consumer[textServiceProperty] = { sendText };

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(withMessageInFlight).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(legacyDuplicateCases)(
    'terminalizes a legacy/corrupt %s %s schedule as ambiguous without a second provider call',
    async (
      providerName,
      Consumer,
      textServiceProperty,
      sourceProvider,
      duplicateState,
      result
    ) => {
      const message = {
        message_id: `scheduled-legacy-${sourceProvider}-${duplicateState}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-legacy',
        attempt_id: 'attempt-legacy',
        contact_id: 'contact-legacy',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const recoverLegacyAmbiguous = jest.fn(async () => 'transitioned');
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = { recoverLegacyAmbiguous };
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'duplicate',
        state: duplicateState,
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: null,
        result,
      }));
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(sendText).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(recoverLegacyAmbiguous).toHaveBeenCalledWith(
        expect.objectContaining({
          state: duplicateState,
          operationId: message.message_id,
        }),
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          provider: sourceProvider,
          operation_id: message.message_id,
        }),
        expect.objectContaining({
          provider: sourceProvider,
          account_id: 'account-1',
          message_id: message.message_id,
          worker_id: 'worker-1',
          schedule_id: payload.schedule_id,
          contact_id: payload.contact_id,
        }),
        [
          'attempt_id',
          'runtime_generation',
          'connection_epoch',
          'consumer_assignment_epoch',
        ]
      );
      expect(setMessageOperationalState).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
          attemptId: payload.attempt_id,
        }),
        'ambiguous'
      );
    }
  );

  it.each(legacyRecoveryFailureCases)(
    'keeps the %s offset uncommitted when legacy schedule CAS returns %s',
    async (
      _providerName,
      Consumer,
      textServiceProperty,
      sourceProvider,
      transitionStatus
    ) => {
      const message = {
        message_id: `scheduled-legacy-failure-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-legacy-failure',
        attempt_id: 'attempt-legacy-failure',
        contact_id: 'contact-legacy-failure',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const sendText = jest.fn();
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = {
        recoverLegacyAmbiguous: jest.fn(async () => transitionStatus),
      };
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'duplicate',
        state: 'ambiguous',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: null,
        result: null,
      }));
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(setMessageOperationalState).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'moves a legacy %s recovery identity conflict out of pending without invoking the provider',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-legacy-conflict-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-legacy-conflict',
        attempt_id: 'attempt-legacy-conflict',
        contact_id: 'contact-legacy-conflict',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = {
        recoverLegacyAmbiguous: jest.fn(async () => 'identity_conflict'),
      };
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'duplicate',
        state: 'ambiguous',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: null,
        result: null,
      }));
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(sendText).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(setMessageOperationalState).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
          attemptId: payload.attempt_id,
        }),
        'pre_provider_failed'
      );
    }
  );

  it.each(providerCases)(
    'does not complete a %s offset when its effect lease enters fence draining before provider scope capture',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-fence-draining-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-fence-draining',
        attempt_id: 'attempt-fence-draining',
        contact_id: 'contact-fence-draining',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-fence-draining',
        result: null,
      };
      const releaseReservation = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState: jest.fn(async () => 'transitioned'),
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = { releaseReservation };
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();
      const incomingProperty =
        sourceProvider === 'baileys'
          ? 'baileysIncomingMessageService'
          : 'wwebjsIncomingMessageService';
      consumer[incomingProperty] = {
        captureActiveConnectionScope: jest.fn(async () => null),
      };

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(consumer.claimMessageSend).not.toHaveBeenCalled();
      expect(releaseReservation).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'keeps the %s delivery uncommitted when another pod owns the distributed in-flight lease',
    async (_providerName, Consumer) => {
      const payload = {
        schedule_id: 'schedule-1',
        attempt_id: 'attempt-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message: {
          message_id: 'scheduled-message-owned-by-other-pod',
          chat_id: '5511999999999@s.whatsapp.net',
          account: { id: 'account-1' },
          worker: { id: 'worker-1' },
          content: { type: 'text', message: 'scheduled hello' },
        },
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.scheduleStatusCoordinationService = {
        withMessageInFlight: jest.fn(async () => {
          throw new ScheduleMessageInFlightLeaseUnavailableError(
            payload.schedule_id,
            payload.message.message_id
          );
        }),
      };
      consumer.claimMessageSend = jest.fn();
      consumer.handleMessage = jest.fn();
      consumer.sendStatusUpdateBestEffort = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(
        consumer.scheduleStatusCoordinationService.withMessageInFlight
      ).toHaveBeenCalledWith(
        {
          scheduleId: payload.schedule_id,
          messageId: payload.message.message_id,
          attemptId: 'attempt-1',
        },
        expect.any(Function)
      );
      expect(consumer.claimMessageSend).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'redrives a raw %s Redis failure while claiming the schedule in-flight lease without provider or status side effects',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const redisError = Object.assign(new Error('Redis eval unavailable'), {
        code: 'ECONNRESET',
      });
      const payload = {
        schedule_id: 'schedule-inflight-redis',
        attempt_id: 'attempt-inflight-redis',
        contact_id: 'contact-inflight-redis',
        account_id: 'account-1',
        is_validated: true,
        message: {
          message_id: `schedule-inflight-redis-${sourceProvider}`,
          chat_id: '5511999999999@s.whatsapp.net',
          account: { id: 'account-1' },
          worker: { id: 'worker-1' },
          content: { type: EMessageType.text, message: 'hello' },
        },
      };
      const sendText = jest.fn();
      const sendStatusUpdateBestEffort = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeScheduleMessages = new Map();
      consumer.scheduleStatusCoordinationService = {
        withMessageInFlight: jest.fn(async () => {
          throw redisError;
        }),
      };
      consumer.messageSendIdempotencyService = {};
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();
      consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: redisError,
      });

      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'redrives a raw %s Redis/lock failure before the provider boundary without terminalizing the schedule',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const lockError = Object.assign(new Error('Redis lock unavailable'), {
        code: 'ECONNRESET',
      });
      const message = {
        message_id: `schedule-lock-redis-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const payload = {
        schedule_id: 'schedule-lock-redis',
        attempt_id: 'attempt-lock-redis',
        contact_id: 'contact-lock-redis',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-lock-redis',
        result: null,
      };
      const releaseReservation = jest.fn(async () => 'transitioned');
      const markFailed = jest.fn();
      const sendText = jest.fn();
      const sendStatusUpdateBestEffort = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.providerInvocationTransitionUncertainClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.messageSendIdempotencyService = {
        releaseReservation,
        markFailed,
      };
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn();
      consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;
      (withLock as jest.Mock).mockRejectedValueOnce(lockError);

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: lockError,
      });

      expect(releaseReservation).toHaveBeenCalledWith(claim);
      expect(markFailed).not.toHaveBeenCalled();
      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'redrives a %s Redis failure while durably transitioning an explicit business failure and never calls the provider',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const redisError = Object.assign(
        new Error('schedule operational Redis unavailable'),
        { code: 'ECONNRESET' }
      );
      const message = {
        message_id: `schedule-operational-redis-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: null,
      };
      const payload = {
        schedule_id: 'schedule-operational-redis',
        attempt_id: 'attempt-operational-redis',
        contact_id: 'contact-operational-redis',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-operational-redis',
        result: null,
      };
      const markFailed = jest.fn(async () => 'transitioned');
      const releaseReservation = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const sendStatusUpdateBestEffort = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.providerInvocationTransitionUncertainClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState: jest.fn(async () => 'transitioned'),
        setMessageOperationalStateFromLedger: jest.fn(async () => {
          throw redisError;
        }),
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = {
        markFailed,
        releaseReservation,
      };
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer[textServiceProperty] = { sendText };
      consumer.handleMessage = jest.fn(async () => {
        throw new Error('Message type is required');
      });
      consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: redisError,
      });

      expect(markFailed).toHaveBeenCalledWith(
        claim,
        expect.any(Error),
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          operation_id: message.message_id,
          attempt_id: payload.attempt_id,
        })
      );
      expect(releaseReservation).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysMessageTextService', 'baileys'],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsMessageTextService',
      'wwebjs',
    ],
  ])(
    'keeps an ambiguous %s provider ACK terminal and never emits failed side effects',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const providerError = new Error('provider_ack_unknown');
      const message = {
        message_id: 'scheduled-ambiguous-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        attempt_id: 'attempt-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-ambiguous-key',
        owner: 'owner-1',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _quoted: unknown,
          beforeProviderSend: () => Promise<void>
        ) => {
          await beforeProviderSend();
          throw providerError;
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.resolveValidatedJid = jest.fn(
        async () => '5511999999999@s.whatsapp.net'
      );
      consumer[textServiceProperty] = { sendText };
      consumer.sendSendLog = jest.fn();
      consumer.sendStatusUpdateBestEffort = jest.fn();
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.processScheduleMessage('worker-1', payload)
        ).resolves.toBeUndefined();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        claim,
        providerError,
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          provider: sourceProvider,
          message_id: message.message_id,
        })
      );
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
      expect(consumer.sendSendLog).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysMessageTextService', 'baileys'],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsMessageTextService',
      'wwebjs',
    ],
  ])(
    'redelivers a %s schedule fenced on the stalled provider scope without failed side effects',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const message = {
        message_id: `scheduled-stalled-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-stalled',
        attempt_id: 'attempt-stalled',
        contact_id: 'contact-stalled',
        account_id: 'account-1',
        is_validated: true,
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `schedule-stalled-${sourceProvider}`,
        owner: 'owner-stalled',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const sendText = jest.fn(async () => {
        throw new ProviderInvocationInFlightError();
      });
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.resolveValidatedJid = jest.fn(
        async () => '5511999999999@s.whatsapp.net'
      );
      consumer[textServiceProperty] = { sendText };
      consumer.sendSendLog = jest.fn();
      consumer.sendStatusUpdateBestEffort = jest.fn();
      consumer.transitionSchedulePreProviderFailureBestEffort = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(
        consumer.transitionSchedulePreProviderFailureBestEffort
      ).not.toHaveBeenCalled();
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
      expect(consumer.sendSendLog).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'reverses the %s provider claim and does not start the provider when dispatch revocation immediately follows the CAS',
    async (_providerName, Consumer) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const message = {
        message_id: 'scheduled-fenced-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-fenced-key',
        owner: 'owner-1',
        result: null,
      };
      let providerMarked = false;
      const idempotency = {
        markProviderInvoked: jest.fn(async () => {
          providerMarked = true;
          return 'transitioned';
        }),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (providerMarked) {
          throw dispatchRevoked;
        }
      });
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(message.message_id);
        providerCall();
      });
      consumer.sendStatusUpdateBestEffort = jest.fn();

      await expect(
        consumer.processScheduleMessage(
          'worker-1',
          payload,
          assertDispatchActive
        )
      ).rejects.toBe(dispatchRevoked);

      expect(providerCall).not.toHaveBeenCalled();
      expect(idempotency.markProviderInvoked).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          schema_version: 'schedule_send_ambiguous_recovery_v1',
          provider: sourceProvider,
          message_id: message.message_id,
        }),
        expect.any(Number)
      );
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'keeps the %s schedule fail-closed without starting the provider when post-CAS reversal is uncertain',
    async (_providerName, Consumer) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const message = {
        message_id: 'scheduled-fenced-uncertain',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-uncertain',
        contact_id: 'contact-uncertain',
        account_id: 'account-1',
        message,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'schedule-fenced-uncertain-key',
        owner: 'owner-uncertain',
        result: null,
      };
      let providerMarked = false;
      const idempotency = {
        markProviderInvoked: jest.fn(async () => {
          providerMarked = true;
          return 'transitioned';
        }),
        revertProviderInvocationBeforeStart: jest.fn(async () => 'error'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (providerMarked) {
          throw new KafkaConsumerDispatchRevokedError();
        }
      });
      const setMessageOperationalState = jest.fn(async () => 'transitioned');
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState,
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(message.message_id);
        providerCall();
      });
      consumer.sendStatusUpdateBestEffort = jest.fn();

      await expect(
        consumer.processScheduleMessage(
          'worker-1',
          payload,
          assertDispatchActive
        )
      ).resolves.toBeUndefined();

      expect(providerCall).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).toHaveBeenCalledTimes(1);
      expect(setMessageOperationalState).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: payload.schedule_id,
          messageId: message.message_id,
        }),
        'ambiguous'
      );
      expect(consumer.sendStatusUpdateBestEffort).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'does not resend through %s and republishes update plus sent status',
    async (_providerName, Consumer) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const message = {
        message_id: 'scheduled-message-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message,
      };
      const update = {
        worker_id: connectionScope.worker_id,
        source_provider: connectionScope.source_provider as
          'baileys' | 'wwebjs',
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
        message: { key: { id: 'provider-scheduled-message-1' } },
        data: message,
      } as IUpdateMessage;
      ensureMessageUpdateIdentity(update);
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: 'scheduled-message-1',
        key: 'message-send:idempotency:v3:schedule-test',
        owner: 'owner-1',
        result: null,
      };
      const duplicateClaim = {
        ...acquiredClaim,
        status: 'duplicate',
        state: 'succeeded',
        owner: null,
        result: { update_message: update },
      };
      const streamProducerService = {
        send: jest
          .fn<Promise<void>, unknown[]>()
          .mockRejectedValueOnce(new Error('update Kafka unavailable'))
          .mockResolvedValue(undefined),
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'invalid_state'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce(duplicateClaim);
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload.message.message_id);
        await consumer.pushUpdate(update);
      });

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(streamProducerService.send).toHaveBeenCalledTimes(3);
      expect(streamProducerService.send.mock.calls[1][1]).toEqual(update);
      expect(streamProducerService.send.mock.calls[2]).toEqual([
        'schedule.status.update',
        expect.objectContaining({
          event_id: expect.stringMatching(/^schedule_status_v1_/),
          worker_id: 'worker-1',
          source_provider: sourceProvider,
          runtime_generation: 7,
          connection_epoch: 'connection-7',
          schedule_id: 'schedule-1',
          contact_id: 'contact-1',
          message_id: 'scheduled-message-1',
          status: EScheduleStatus.sent,
        }),
        'schedule-1:contact-1:scheduled-message-1',
        undefined,
        expect.any(Function),
      ]);
    }
  );

  it.each([
    ['Baileys', 'baileys', ScheduleMessageConsume],
    ['WWebJS', 'wwebjs', ScheduleMessageWwebjsConsume],
  ])(
    'redrives a raw %s Redis fence failure after markSucceeded and recovers on the next generation without provider replay',
    async (_providerName, sourceProvider, Consumer) => {
      const firstScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const recoveredScope = {
        ...firstScope,
        runtime_generation: 8,
        connection_epoch: 'connection-8',
      };
      const message = {
        message_id: `scheduled-post-succeeded-redis-${sourceProvider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-post-succeeded-redis',
        contact_id: 'contact-post-succeeded-redis',
        account_id: 'account-1',
        message,
      };
      const update = {
        message: { key: { id: `provider-${message.message_id}` } },
        data: message,
      } as IUpdateMessage;
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: `${message.message_id}-key`,
        owner: 'owner-post-succeeded-redis',
        result: null,
      };
      const duplicateClaim = {
        ...acquiredClaim,
        status: 'duplicate',
        state: 'succeeded',
        owner: null,
        result: { update_message: update },
      };
      const redisError = Object.assign(
        new Error('runtime fence Redis unavailable after succeeded CAS'),
        { code: 'ECONNRESET' }
      );
      const send = jest.fn<Promise<void>, unknown[]>(async () => undefined);
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'invalid_state'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.providerInvocationTransitionUncertainClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeScheduleLeaseGuards = new Map();
      consumer.activeScheduleAttemptIds = new Map();
      consumer.activeScheduleMessages = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        isCurrent: jest
          .fn()
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(redisError)
          .mockResolvedValue(true),
      };
      consumer.captureActiveConnectionScope = jest
        .fn()
        .mockResolvedValueOnce(firstScope)
        .mockResolvedValueOnce(recoveredScope);
      consumer.streamProducerService = { send };
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.scheduleStatusCoordinationService = {
        setMessageOperationalState: jest.fn(async () => 'transitioned'),
        setMessageOperationalStateFromLedger: jest.fn(
          async () => 'transitioned'
        ),
        withMessageInFlight: jest.fn(
          async (
            _input: unknown,
            callback: (assertOwned: () => Promise<void>) => Promise<unknown>
          ) => callback(jest.fn(async () => undefined))
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce(duplicateClaim);
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(message.message_id);
        await consumer.pushUpdate(update);
      });

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: redisError,
      });
      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          worker_id: 'worker-1',
          source_provider: sourceProvider,
          runtime_generation: 8,
          connection_epoch: 'connection-8',
        })
      );
      expect(send.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          status: EScheduleStatus.sent,
          runtime_generation: 8,
          connection_epoch: 'connection-8',
        })
      );
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'recovers a failed %s sent-status publication without invoking the provider again',
    async (_providerName, Consumer) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const message = {
        message_id: 'scheduled-message-status-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message,
      };
      const update = {
        worker_id: connectionScope.worker_id,
        source_provider: connectionScope.source_provider as
          'baileys' | 'wwebjs',
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
        message: { key: { id: 'provider-scheduled-message-status-1' } },
        data: message,
      } as IUpdateMessage;
      ensureMessageUpdateIdentity(update);
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: 'scheduled-message-status-1',
        key: 'message-send:idempotency:v3:schedule-status-test',
        owner: 'owner-1',
        result: null,
      };
      const duplicateClaim = {
        ...acquiredClaim,
        status: 'duplicate',
        state: 'succeeded',
        owner: null,
        result: { update_message: update },
      };
      const streamProducerService = {
        send: jest
          .fn<Promise<void>, unknown[]>()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('status Kafka unavailable'))
          .mockResolvedValue(undefined),
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'invalid_state'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.redis = {};
      consumer.runtimeFence = {
        view: jest.fn(async () => connectionScope),
        isCurrent: jest.fn(async () => true),
      };
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce(duplicateClaim);
      consumer.handleMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload.message.message_id);
        await consumer.pushUpdate(update);
        await consumer.sendSentStatusUpdate(
          payload.schedule_id,
          payload.contact_id,
          payload.message.message_id,
          EScheduleStatus.sent
        );
      });

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
      expect(streamProducerService.send).toHaveBeenCalledTimes(4);
      expect(streamProducerService.send.mock.calls[0][0]).toBe(
        'update.message'
      );
      expect(streamProducerService.send.mock.calls[1][0]).toBe(
        'schedule.status.update'
      );
      expect(streamProducerService.send.mock.calls[2][0]).toBe(
        'update.message'
      );
      expect(streamProducerService.send.mock.calls[3][0]).toBe(
        'schedule.status.update'
      );
    }
  );

  it.each([
    ['Baileys', 'baileys', ScheduleMessageConsume],
    ['WWebJS', 'wwebjs', ScheduleMessageWwebjsConsume],
  ])(
    'does not let a revoked %s duplicate recovery republish anything',
    async (_providerName, sourceProvider, Consumer) => {
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const message = {
        message_id: 'scheduled-revoked-recovery-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message,
      };
      const duplicateClaim = {
        status: 'duplicate',
        state: 'succeeded',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'message-send:idempotency:v3:schedule-revoked-recovery',
        owner: null,
        result: {
          update_message: {
            worker_id: 'worker-1',
            source_provider: sourceProvider,
            runtime_generation: 7,
            connection_epoch: 'connection-7',
            message: { key: { id: 'provider-revoked-recovery-1' } },
            data: message,
          },
        },
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.runtimeFence = {
        isCurrent: jest.fn(async () => true),
      };
      consumer.streamProducerService = { send: jest.fn() };
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.claimMessageSend = jest.fn(async () => duplicateClaim);
      const assertDispatchActive = jest.fn(() => {
        throw dispatchRevoked;
      });

      await expect(
        consumer.processScheduleMessage(
          'worker-1',
          payload,
          assertDispatchActive
        )
      ).rejects.toBe(dispatchRevoked);

      expect(consumer.runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', 'baileys', ScheduleMessageConsume],
    ['WWebJS', 'wwebjs', ScheduleMessageWwebjsConsume],
  ])(
    'safely rebinds a succeeded %s redrive from an obsolete connection epoch to the current generation',
    async (_providerName, sourceProvider, Consumer) => {
      const message = {
        message_id: 'scheduled-stale-redrive-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: 'text', message: 'scheduled hello' },
      };
      const payload = {
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        account_id: 'account-1',
        message,
      };
      const persistedUpdate = {
        worker_id: 'worker-1',
        source_provider: sourceProvider as 'baileys' | 'wwebjs',
        runtime_generation: 6,
        connection_epoch: 'connection-6',
        message: { key: { id: 'provider-stale-redrive-1' } },
        data: message,
      } as IUpdateMessage;
      ensureMessageUpdateIdentity(persistedUpdate);
      const duplicateClaim = {
        status: 'duplicate',
        state: 'succeeded',
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: message.message_id,
        key: 'message-send:idempotency:v3:schedule-stale-redrive',
        owner: null,
        result: {
          update_message: persistedUpdate,
        },
      };
      const send = jest.fn<Promise<void>, unknown[]>(async () => undefined);
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.runtimeFence = {
        isCurrent: jest.fn(async () => true),
      };
      consumer.streamProducerService = { send };
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      };
      consumer.claimMessageSend = jest.fn(async () => duplicateClaim);
      consumer.handleMessage = jest.fn();

      await expect(
        consumer.processScheduleMessage('worker-1', payload)
      ).resolves.toBeUndefined();

      expect(consumer.handleMessage).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          event_id: persistedUpdate.event_id,
          worker_id: 'worker-1',
          source_provider: sourceProvider,
          runtime_generation: 7,
          connection_epoch: 'connection-7',
        })
      );
      expect(send.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          status: EScheduleStatus.sent,
          runtime_generation: 7,
          connection_epoch: 'connection-7',
        })
      );
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysPhoneValidationService'],
    ['WWebJS', ScheduleMessageWwebjsConsume, 'wwebjsPhoneValidationService'],
  ])(
    'discards a %s contact-validation result after assignment revocation',
    async (_providerName, Consumer, validationProperty) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const messageId = 'scheduled-validation-fenced-1';
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendConnectionScopes = new Map([
        [messageId, connectionScope],
      ]);
      consumer.activeScheduleLeaseGuards = new Map([
        [messageId, jest.fn(async () => undefined)],
      ]);
      consumer.runtimeFence = {
        isCurrent: jest.fn(async () => true),
      };
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => ({
          valid: true,
          jid: '5511999999999@s.whatsapp.net',
          phone: '5511999999999',
        })),
      };
      consumer.kafkaServiceQueueService = {
        contactValidationUpdate: jest.fn(
          () => 'contact.validation.schedule.update'
        ),
      };
      consumer.streamProducerService = { send: jest.fn() };
      const assertDispatchActive = jest
        .fn<void, []>()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw dispatchRevoked;
        });

      await expect(
        consumer.resolveValidatedJid(
          {
            schedule_id: 'schedule-1',
            contact_id: 'contact-1',
            is_validated: false,
            message: {
              message_id: messageId,
              phone: '11999999999',
              phone_ddi: '55',
            },
          },
          '5511999999999@s.whatsapp.net',
          assertDispatchActive
        )
      ).rejects.toBe(dispatchRevoked);

      expect(assertDispatchActive).toHaveBeenCalledTimes(5);
      expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysPhoneValidationService'],
    ['WWebJS', ScheduleMessageWwebjsConsume, 'wwebjsPhoneValidationService'],
  ])(
    'discards a %s contact-validation result when connection_epoch changes during validation',
    async (_providerName, Consumer, validationProperty) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const messageId = 'scheduled-validation-epoch-switch-1';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      let activeConnectionEpoch = connectionScope.connection_epoch;
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendConnectionScopes = new Map([
        [messageId, connectionScope],
      ]);
      consumer.activeScheduleLeaseGuards = new Map([
        [messageId, jest.fn(async () => undefined)],
      ]);
      consumer.runtimeFence = {
        isCurrent: jest.fn(
          async (scope: typeof connectionScope) =>
            scope.connection_epoch === activeConnectionEpoch
        ),
      };
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => {
          activeConnectionEpoch = 'connection-8';
          return {
            valid: true,
            jid: '5511999999999@s.whatsapp.net',
            phone: '5511999999999',
          };
        }),
      };
      consumer.kafkaServiceQueueService = {
        contactValidationUpdate: jest.fn(
          () => 'contact.validation.schedule.update'
        ),
      };
      consumer.streamProducerService = { send: jest.fn() };

      await expect(
        consumer.resolveValidatedJid(
          {
            schedule_id: 'schedule-1',
            attempt_id: 'attempt-epoch-switch-1',
            account_id: 'account-1',
            contact_id: 'contact-1',
            is_validated: false,
            message: {
              message_id: messageId,
              phone: '11999999999',
              phone_ddi: '55',
              account: { id: 'account-1' },
            },
          },
          '5511999999999@s.whatsapp.net'
        )
      ).rejects.toMatchObject({
        message: 'whatsapp_connection_scope_revoked',
      });

      expect(consumer[validationProperty].validatePhone).toHaveBeenCalledTimes(
        1
      );
      expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysPhoneValidationService'],
    ['WWebJS', ScheduleMessageWwebjsConsume, 'wwebjsPhoneValidationService'],
  ])(
    'fences a %s contact-validation publication when connection_epoch changes while Kafka acknowledges it',
    async (_providerName, Consumer, validationProperty) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const messageId = 'scheduled-validation-publication-switch-1';
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      let activeConnectionEpoch = connectionScope.connection_epoch;
      const send = jest.fn(async () => {
        activeConnectionEpoch = 'connection-8';
      });
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendConnectionScopes = new Map([
        [messageId, connectionScope],
      ]);
      consumer.activeScheduleLeaseGuards = new Map([
        [messageId, jest.fn(async () => undefined)],
      ]);
      consumer.runtimeFence = {
        isCurrent: jest.fn(
          async (scope: typeof connectionScope) =>
            scope.connection_epoch === activeConnectionEpoch
        ),
      };
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => ({
          valid: true,
          jid: '5511999999999@s.whatsapp.net',
          phone: '5511999999999',
        })),
      };
      consumer.kafkaServiceQueueService = {
        contactValidationUpdate: jest.fn(
          () => 'contact.validation.schedule.update'
        ),
      };
      consumer.streamProducerService = { send };

      await expect(
        consumer.resolveValidatedJid(
          {
            schedule_id: 'schedule-1',
            attempt_id: 'attempt-publication-switch-1',
            account_id: 'account-1',
            contact_id: 'contact-1',
            is_validated: false,
            message: {
              message_id: messageId,
              phone: '11999999999',
              phone_ddi: '55',
              account: { id: 'account-1' },
            },
          },
          '5511999999999@s.whatsapp.net'
        )
      ).rejects.toMatchObject({
        message: 'whatsapp_connection_scope_revoked',
      });

      expect(send).toHaveBeenCalledWith(
        'contact.validation.schedule.update',
        {
          contact_id: 'contact-1',
          phone: '5511999999999',
          is_validated: true,
          account_id: 'account-1',
          worker_id: 'worker-1',
          source_provider: sourceProvider,
          runtime_generation: 7,
          connection_epoch: 'connection-7',
          operation_id: 'attempt-publication-switch-1',
          source: 'schedule',
        },
        'account-1:contact-1',
        undefined,
        expect.any(Function)
      );
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'does not persist a %s send log after assignment revocation',
    async (_providerName, Consumer) => {
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const updateField = jest.fn(async () => undefined);
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendDispatchGuards = new Map([
        [
          'scheduled-send-log-fenced-1',
          jest
            .fn<void, []>()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
              throw dispatchRevoked;
            }),
        ],
      ]);
      consumer.elasticDatabaseService = {
        indices: jest.fn(async () => undefined),
        updateField,
      };

      await expect(
        consumer.sendSendLog(
          {
            message: {
              message_id: 'scheduled-send-log-fenced-1',
              content: { type: 'text', message: 'body' },
            },
          },
          '5511999999999@s.whatsapp.net',
          { key: { id: 'provider-message-1' } },
          null,
          true
        )
      ).rejects.toBe(dispatchRevoked);

      expect(updateField).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume],
    ['WWebJS', ScheduleMessageWwebjsConsume],
  ])(
    'terminally rejects malformed %s schedule payloads in the parser',
    (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const base = {
        schedule_id: 'schedule-parser-1',
        attempt_id: 'attempt-parser-1',
        account_id: 'account-1',
        contact_id: 'contact-parser-1',
        is_validated: false,
        message: {
          message_id: 'message-parser-1',
          chat_id: 'chat-parser-1',
          phone: '11999999999',
          phone_ddi: '55',
          account: { id: 'account-1' },
          worker: { id: 'worker-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
            is_view_once: false,
          },
          content: { type: EMessageType.text, message: 'body' },
        },
      };
      const malformed = [
        { ...base, schedule_id: 123 },
        { ...base, is_validated: 'false' },
        { ...base, message: null },
        { ...base, message: { ...base.message, message_id: 123 } },
        { ...base, message: { ...base.message, phone: 11999999999 } },
        {
          ...base,
          message: {
            ...base.message,
            message_key: { remote_jid: 5511999999999 },
          },
        },
        { ...base, message: { ...base.message, content: null } },
        {
          ...base,
          message: {
            ...base.message,
            content: {
              type: EMessageType.image,
              image: { url: 123 },
            },
          },
        },
        {
          ...base,
          message: {
            ...base.message,
            content: {
              type: EMessageType.video,
              video: {
                url: 'https://storage.test/video.mp4',
                mimetype: 123,
              },
            },
          },
        },
        {
          ...base,
          message: {
            ...base.message,
            content: {
              type: EMessageType.video,
              video: {
                url: 'https://storage.test/video.mp4',
                name: 123,
              },
            },
          },
        },
        {
          ...base,
          message: {
            ...base.message,
            content: {
              type: EMessageType.audio,
              audio: {
                url: 'https://storage.test/audio.ogg',
                ptt: 'yes',
              },
            },
          },
        },
      ];

      for (const payload of malformed) {
        expect(
          consumer.parseMessage(Buffer.from(JSON.stringify(payload), 'utf8'))
        ).toBeNull();
      }
      expect(
        consumer.parseMessage(Buffer.from(JSON.stringify(base), 'utf8'))
      ).toEqual(base);
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysPhoneValidationService'],
    ['WWebJS', ScheduleMessageWwebjsConsume, 'wwebjsPhoneValidationService'],
  ])(
    'redrives every opaque/capacity/stall/timeout %s phone-validation exception after three local attempts',
    async (_providerName, Consumer, validationProperty) => {
      const sourceProvider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const technicalErrors = [
        new Error('boom'),
        new ProviderInvocationInFlightError('capacity'),
        new ProviderInvocationInFlightError('stalled'),
        new ProviderAuxiliaryInvocationTimeoutError(
          sourceProvider,
          'validate_phone',
          1000
        ),
      ];
      const warning = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        for (const technicalError of technicalErrors) {
          jest.useFakeTimers();
          const messageId = `validation-${technicalError.name}-${sourceProvider}`;
          const connectionScope = {
            worker_id: 'worker-1',
            source_provider: sourceProvider,
            runtime_generation: 7,
            connection_epoch: 'connection-7',
            activated_at: Date.now(),
          };
          const validatePhone = jest.fn(async () => {
            throw technicalError;
          });
          const consumer = Object.create(Consumer.prototype) as any;
          consumer.activeSendConnectionScopes = new Map([
            [messageId, connectionScope],
          ]);
          consumer.activeScheduleLeaseGuards = new Map([
            [messageId, jest.fn(async () => undefined)],
          ]);
          consumer.runtimeFence = {
            isCurrent: jest.fn(async () => true),
          };
          consumer[validationProperty] = { validatePhone };
          consumer.streamProducerService = { send: jest.fn() };
          consumer.kafkaServiceQueueService = {
            contactValidationUpdate: jest.fn(
              () => 'contact.validation.schedule.update'
            ),
          };
          const promise = consumer.resolveValidatedJid(
            {
              schedule_id: 'schedule-validation-redrive',
              attempt_id: 'attempt-validation-redrive',
              account_id: 'account-1',
              contact_id: 'contact-validation-redrive',
              is_validated: false,
              message: {
                message_id: messageId,
                phone: '11999999999',
                phone_ddi: '55',
                account: { id: 'account-1' },
              },
            },
            '5511999999999@s.whatsapp.net'
          );
          const rejected = expect(promise).rejects.toMatchObject({
            name: 'MessageUpdatePublishFailedError',
            originalCause: technicalError,
          });

          await jest.advanceTimersByTimeAsync(3_000);
          await rejected;
          expect(validatePhone).toHaveBeenCalledTimes(3);
          expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
          jest.useRealTimers();
        }
      } finally {
        warning.mockRestore();
        jest.useRealTimers();
      }
    }
  );

  it.each([
    ['Baileys', ScheduleMessageConsume, 'baileysMessageTextService', 'baileys'],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsMessageTextService',
      'wwebjs',
    ],
  ])(
    'redrives disconnected, quoted-lookup and opaque %s failures before the provider boundary without failed/ignored status',
    async (_providerName, Consumer, textServiceProperty, sourceProvider) => {
      const auxiliaryProvider = sourceProvider as 'baileys' | 'wwebjs';
      const failures = [
        new Error(
          sourceProvider === 'baileys'
            ? 'Socket not connected'
            : 'Wwebjs client not connected'
        ),
        new ProviderAuxiliaryInvocationTimeoutError(
          auxiliaryProvider,
          'quoted_message_lookup',
          1000
        ),
        new Error('opaque SDK preflight failure'),
      ];

      for (const failure of failures) {
        const messageId = `schedule-preflight-${failure.name}-${sourceProvider}`;
        const transitionSchedulePreProviderFailureBestEffort = jest.fn();
        const sendStatusUpdateBestEffort = jest.fn();
        const sendSendLog = jest.fn();
        const consumer = Object.create(Consumer.prototype) as any;
        consumer.activeSendDispatchGuards = new Map([
          [messageId, jest.fn(() => undefined)],
        ]);
        consumer.providerInvokedSendClaims = new Set();
        consumer.resolveValidatedJid = jest.fn(
          async () => '5511999999999@s.whatsapp.net'
        );
        consumer[textServiceProperty] = {
          sendText: jest.fn(async () => {
            throw failure;
          }),
        };
        consumer.transitionSchedulePreProviderFailureBestEffort =
          transitionSchedulePreProviderFailureBestEffort;
        consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;
        consumer.sendSendLog = sendSendLog;
        const payload = {
          schedule_id: 'schedule-preflight',
          contact_id: 'contact-preflight',
          is_validated: true,
          message: {
            message_id: messageId,
            chat_id: 'chat-preflight',
            phone: '11999999999',
            phone_ddi: '55',
            account: { id: 'account-1' },
            worker: { id: 'worker-1' },
            message_key: {
              remote_jid: '5511999999999@s.whatsapp.net',
              is_view_once: false,
            },
            content: { type: EMessageType.text, message: 'body' },
          },
        };

        await expect(consumer.handleMessage(payload)).rejects.toMatchObject({
          name: 'MessageUpdatePublishFailedError',
          originalCause: failure,
        });
        expect(
          transitionSchedulePreProviderFailureBestEffort
        ).not.toHaveBeenCalled();
        expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
        expect(sendSendLog).not.toHaveBeenCalled();
      }
    }
  );

  it.each([
    [
      'Baileys',
      ScheduleMessageConsume,
      'baileysPhoneValidationService',
      'baileysMessageTextService',
      'baileys',
    ],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsPhoneValidationService',
      'wwebjsMessageTextService',
      'wwebjs',
    ],
  ])(
    'redrives a %s invalid-phone publication outage without provider call or ignored/failed status',
    async (
      _providerName,
      Consumer,
      validationProperty,
      textServiceProperty,
      sourceProvider
    ) => {
      const messageId = `invalid-phone-publish-${sourceProvider}`;
      const connectionScope = {
        worker_id: 'worker-1',
        source_provider: sourceProvider,
        runtime_generation: 7,
        connection_epoch: 'connection-7',
        activated_at: Date.now(),
      };
      const publishError = new Error('contact validation Kafka unavailable');
      const sendText = jest.fn();
      const sendStatusUpdateBestEffort = jest.fn();
      const transitionSchedulePreProviderFailureBestEffort = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendConnectionScopes = new Map([
        [messageId, connectionScope],
      ]);
      consumer.activeScheduleLeaseGuards = new Map([
        [messageId, jest.fn(async () => undefined)],
      ]);
      consumer.activeSendDispatchGuards = new Map([
        [messageId, jest.fn(() => undefined)],
      ]);
      consumer.providerInvokedSendClaims = new Set();
      consumer.runtimeFence = { isCurrent: jest.fn(async () => true) };
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => {
          throw new Error('phone_number_not_valid_on_whatsapp');
        }),
      };
      consumer[textServiceProperty] = { sendText };
      consumer.publishContactValidationUpdate = jest.fn(async () => {
        throw publishError;
      });
      consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;
      consumer.transitionSchedulePreProviderFailureBestEffort =
        transitionSchedulePreProviderFailureBestEffort;
      const payload = {
        schedule_id: 'schedule-invalid-phone',
        attempt_id: 'attempt-invalid-phone',
        account_id: 'account-1',
        contact_id: 'contact-invalid-phone',
        is_validated: false,
        message: {
          message_id: messageId,
          chat_id: 'chat-invalid-phone',
          phone: '11999999999',
          phone_ddi: '55',
          account: { id: 'account-1' },
          worker: { id: 'worker-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
            is_view_once: false,
          },
          content: { type: EMessageType.text, message: 'body' },
        },
      };

      await expect(consumer.handleMessage(payload)).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: publishError,
      });

      expect(sendText).not.toHaveBeenCalled();
      expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
      expect(
        transitionSchedulePreProviderFailureBestEffort
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'Baileys',
      ScheduleMessageConsume,
      'baileysMessageMediaService',
      'baileys',
    ],
    [
      'WWebJS',
      ScheduleMessageWwebjsConsume,
      'wwebjsMessageMediaService',
      'wwebjs',
    ],
  ])(
    'redrives transient %s media transport failures and terminalizes only explicit permanent media errors',
    async (_providerName, Consumer, mediaServiceProperty, sourceProvider) => {
      const transientErrors = [
        new MediaDownloadHttpError(408),
        new MediaDownloadHttpError(425),
        new MediaDownloadHttpError(429),
        new MediaDownloadHttpError(503),
        new MediaDownloadTimeoutError(1000),
        new MediaDownloadNetworkError(
          Object.assign(new Error('dns'), { code: 'ENOTFOUND' })
        ),
        new MediaDownloadNetworkError(
          Object.assign(new Error('reset'), { code: 'ECONNRESET' })
        ),
        new MediaDownloadNetworkError(new Error('body stream terminated')),
      ];
      const permanentErrors = [
        new MediaDownloadHttpError(404),
        new MediaDownloadSizeLimitError(8, 9),
        new MediaDownloadInvalidUrlError(),
      ];

      for (const [error, permanent] of [
        ...transientErrors.map((item) => [item, false] as const),
        ...permanentErrors.map((item) => [item, true] as const),
      ]) {
        const messageId = `schedule-media-${error.name}-${sourceProvider}`;
        const transitionSchedulePreProviderFailureBestEffort = jest.fn(
          async () => true
        );
        const sendStatusUpdateBestEffort = jest.fn(async () => undefined);
        const sendSendLog = jest.fn(async () => undefined);
        const consumer = Object.create(Consumer.prototype) as any;
        consumer.activeSendDispatchGuards = new Map([
          [messageId, jest.fn(() => undefined)],
        ]);
        consumer.providerInvokedSendClaims = new Set();
        consumer.resolveValidatedJid = jest.fn(
          async () => '5511999999999@s.whatsapp.net'
        );
        consumer[mediaServiceProperty] = {
          sendImage: jest.fn(async () => {
            throw error;
          }),
        };
        consumer.transitionSchedulePreProviderFailureBestEffort =
          transitionSchedulePreProviderFailureBestEffort;
        consumer.sendStatusUpdateBestEffort = sendStatusUpdateBestEffort;
        consumer.sendSendLog = sendSendLog;
        const payload = {
          schedule_id: 'schedule-media',
          contact_id: 'contact-media',
          is_validated: true,
          message: {
            message_id: messageId,
            chat_id: 'chat-media',
            phone: '11999999999',
            phone_ddi: '55',
            account: { id: 'account-1' },
            worker: { id: 'worker-1' },
            message_key: {
              remote_jid: '5511999999999@s.whatsapp.net',
              is_view_once: false,
            },
            content: {
              type: EMessageType.image,
              image: { url: 'https://storage.test/image.jpg' },
            },
          },
        };

        const outcome = consumer.handleMessage(payload);
        if (permanent) {
          await expect(outcome).rejects.toBe(error);
          expect(
            transitionSchedulePreProviderFailureBestEffort
          ).toHaveBeenCalledWith(payload);
          expect(sendStatusUpdateBestEffort).toHaveBeenCalledWith(
            'schedule-media',
            'contact-media',
            messageId,
            EScheduleStatus.failed
          );
          expect(sendSendLog).toHaveBeenCalledTimes(1);
        } else {
          await expect(outcome).rejects.toMatchObject({
            name: 'MessageUpdatePublishFailedError',
            originalCause: error,
          });
          expect(
            transitionSchedulePreProviderFailureBestEffort
          ).not.toHaveBeenCalled();
          expect(sendStatusUpdateBestEffort).not.toHaveBeenCalled();
          expect(sendSendLog).not.toHaveBeenCalled();
        }
      }
    }
  );
});
