import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'fallback-baileys-account',
    baileysWorkerId: 'worker-1',
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'fallback-wwebjs-account',
    wwebjsWorkerId: 'worker-1',
  },
}));
jest.mock('@core/services/baileys/methods/messageText.service', () => ({
  BaileysMessageTextService: class BaileysMessageTextService {},
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
jest.mock('@core/services/wwebjs/methods/phoneValidation.service', () => ({
  WwebjsPhoneValidationService: class WwebjsPhoneValidationService {},
}));
jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

import { NotificationMessageSendConsume } from '@core/consumer/notification/NotificationMessageSend.consume';
import { NotificationMessageSendWwebjsConsume } from '@core/consumer/notification/NotificationMessageSendWwebjs.consume';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { buildUserPhoneJidUpdateEventId } from '@core/common/functions/userPhoneJidUpdateIdentity';
import { MessageUpdatePublishFailedError } from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { ProviderInvocationInFlightError } from '@core/common/functions/providerInvocationSingleFlight';
import { ProviderAuxiliaryInvocationTimeoutError } from '@core/common/functions/providerAuxiliaryInvocation';
import { buildNotificationPhoneJidRecovery } from '@core/common/functions/providerCommandAuxiliaryRecovery';

describe('notification send idempotency identity', () => {
  const providerCases = [
    [
      'Baileys',
      NotificationMessageSendConsume,
      'baileysPhoneValidationService',
      'baileysMessageTextService',
    ],
    [
      'WWebJS',
      NotificationMessageSendWwebjsConsume,
      'wwebjsPhoneValidationService',
      'wwebjsMessageTextService',
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
  const terminalDuplicateCases = providerCases.flatMap((providerCase) =>
    (['succeeded', 'failed'] as const).map(
      (duplicateState) => [...providerCase, duplicateState] as const
    )
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

  function attachActiveScope(
    consumer: any,
    providerName: string,
    overrides: Record<string, unknown> = {}
  ) {
    const sourceProvider = providerName === 'Baileys' ? 'baileys' : 'wwebjs';
    const property =
      providerName === 'Baileys'
        ? 'baileysIncomingMessageService'
        : 'wwebjsIncomingMessageService';
    const scope = {
      worker_id: 'worker-1',
      runtime_generation: 7,
      connection_epoch: 'epoch-1',
      source_provider: sourceProvider,
      activated_at: 1000,
      ...overrides,
    };
    consumer[property] = {
      captureActiveConnectionScope: jest.fn(async () => scope),
    };
    return { property, scope };
  }

  it.each([
    ['Baileys', NotificationMessageSendConsume, 'fallback-baileys-account'],
    ['WWebJS', NotificationMessageSendWwebjsConsume, 'fallback-wwebjs-account'],
  ])(
    'uses the %s worker account when the notification omits account.id',
    async (providerName, Consumer, expectedAccountId) => {
      const claimOperation = jest.fn(async () => ({
        status: 'acquired',
        state: 'reserved',
      }));
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = { claimOperation };
      const { scope } = attachActiveScope(consumer, providerName);

      await expect(
        consumer.claimNotificationSendAttempt(
          {
            notification_id: 'notification-1',
            message_key: {
              remote_jid: '5511999999999@s.whatsapp.net',
            },
            message_whatsapp: 'notification body',
          },
          scope,
          11
        )
      ).resolves.toMatchObject({ status: 'acquired' });

      expect(claimOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: expectedAccountId,
          operationType: 'notification',
          operationId: 'notification-1\0jid:5511999999999@s.whatsapp.net',
          runtimeFenceKey: 'whatsapp:runtime-fence:v1:worker-1',
          meta: expect.objectContaining({
            runtime_generation: 7,
            connection_epoch: 'epoch-1',
            consumer_assignment_epoch: 11,
          }),
        })
      );
    }
  );

  it.each([
    ['Baileys', NotificationMessageSendConsume, 'fallback-baileys-account'],
    ['WWebJS', NotificationMessageSendWwebjsConsume, 'fallback-wwebjs-account'],
  ])(
    'uses the propagated operation id for %s and keeps the legacy fallback compatible',
    async (providerName, Consumer, expectedAccountId) => {
      const claimOperation = jest.fn(async () => ({
        status: 'acquired',
        state: 'reserved',
      }));
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = { claimOperation };
      const { scope } = attachActiveScope(consumer, providerName);
      const base = {
        notification_id: 'notification-1',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
        },
        message_whatsapp: 'same body',
      };

      await consumer.claimNotificationSendAttempt(
        {
          ...base,
          operation_id: 'operation-1',
        },
        scope,
        11
      );
      await consumer.claimNotificationSendAttempt(base, scope, 11);

      const calls = claimOperation.mock.calls as unknown as Array<
        [Record<string, unknown>]
      >;
      expect(calls[0]?.[0]).toEqual(
        expect.objectContaining({
          accountId: expectedAccountId,
          operationType: 'notification',
          operationId: 'operation-1',
        })
      );
      expect(calls[1]?.[0]).toEqual(
        expect.objectContaining({
          operationId: 'notification-1\0jid:5511999999999@s.whatsapp.net',
        })
      );
    }
  );

  it.each(providerCases)(
    'does not create a %s provider-invoked claim for an invalid phone',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          _providerName === 'Baileys'
            ? 'fallback-baileys-account'
            : 'fallback-wwebjs-account',
        operationType: 'notification',
        operationId: 'notification-invalid\u0000phone:55:11999999999',
        key: 'notification-invalid-key',
        owner: 'notification-invalid-owner',
        result: null,
      };
      const claimOperation = jest.fn(async () => claim);
      const releaseReservation = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      attachActiveScope(consumer, _providerName);
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => ({ valid: false, jid: null })),
      };
      consumer[senderProperty] = { sendText };
      consumer.messageSendIdempotencyService = {
        claimOperation,
        releaseReservation,
      };

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-invalid',
          message_key: { phone_ddi: '55', phone_number: '11999999999' },
          message_whatsapp: 'notification body',
        })
      ).resolves.toBeUndefined();

      expect(claimOperation).toHaveBeenCalledTimes(1);
      expect(releaseReservation).toHaveBeenCalledWith(claim);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'falls back to validated phone resolution for %s instead of sending to a malformed remote JID',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const resolvedJid = '5511999999999@s.whatsapp.net';
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          _providerName === 'Baileys'
            ? 'fallback-baileys-account'
            : 'fallback-wwebjs-account',
        operationType: 'notification',
        operationId: 'notification-phone-fallback\u0000phone:55:11999999999',
        key: 'notification-phone-fallback-key',
        owner: 'notification-phone-fallback-owner',
        result: null,
      };
      const claimOperation = jest.fn(async () => claim);
      const idempotency = {
        claimOperation,
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const validatePhone = jest.fn(async () => ({
        valid: true,
        jid: resolvedJid,
      }));
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      attachActiveScope(consumer, _providerName);
      consumer[validationProperty] = { validatePhone };
      consumer[senderProperty] = { sendText };
      consumer.messageSendIdempotencyService = idempotency;

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-phone-fallback',
          message_key: {
            remote_jid: '12345',
            phone_ddi: '55',
            phone_number: '11999999999',
          },
          message_whatsapp: 'notification body',
        })
      ).resolves.toBeUndefined();

      expect(validatePhone).toHaveBeenCalledWith('55', '11999999999');
      expect(sendText).toHaveBeenCalledWith(
        resolvedJid,
        'notification body',
        undefined,
        expect.any(Function)
      );
      expect(sendText).not.toHaveBeenCalledWith(
        '12345',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      expect(claimOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'notification-phone-fallback\u0000phone:55:11999999999',
          meta: expect.objectContaining({
            destination: 'phone:55:11999999999',
          }),
        })
      );
    }
  );

  it.each(providerCases)(
    'keeps a %s technical phone-validation failure retryable before claiming provider invocation',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          _providerName === 'Baileys'
            ? 'fallback-baileys-account'
            : 'fallback-wwebjs-account',
        operationType: 'notification',
        operationId: 'notification-retry\u0000phone:55:11999999999',
        key: 'notification-retry-key',
        owner: 'notification-retry-owner',
        result: null,
      };
      const claimOperation = jest.fn(async () => claim);
      const releaseReservation = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      attachActiveScope(consumer, _providerName);
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => {
          throw new Error('validation unavailable');
        }),
      };
      consumer[senderProperty] = { sendText };
      consumer.messageSendIdempotencyService = {
        claimOperation,
        releaseReservation,
      };

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-retry',
          message_key: { phone_ddi: '55', phone_number: '11999999999' },
          message_whatsapp: 'notification body',
        })
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: expect.objectContaining({
          message: 'validation unavailable',
        }),
      });

      expect(claimOperation).toHaveBeenCalledTimes(1);
      expect(releaseReservation).toHaveBeenCalledWith(claim);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'normalizes every %s validation capacity/stall/timeout/rebalance failure to durable redrive',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const technicalErrors = [
        new ProviderInvocationInFlightError('capacity'),
        new ProviderInvocationInFlightError('stalled'),
        new ProviderAuxiliaryInvocationTimeoutError(
          _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          'validate_phone',
          1000
        ),
        new KafkaConsumerDispatchRevokedError(),
        new Error('opaque transport failure'),
      ];
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          _providerName === 'Baileys'
            ? 'fallback-baileys-account'
            : 'fallback-wwebjs-account',
        operationType: 'notification',
        operationId: 'notification-technical-redrive\u0000phone:55:11999999999',
        key: 'notification-technical-redrive-key',
        owner: 'notification-technical-redrive-owner',
        result: null,
      };
      const claimOperation = jest.fn(async () => claim);
      const releaseReservation = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const validatePhone = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      attachActiveScope(consumer, _providerName);
      consumer[validationProperty] = { validatePhone };
      consumer[senderProperty] = { sendText };
      consumer.messageSendIdempotencyService = {
        claimOperation,
        releaseReservation,
      };

      for (const technicalError of technicalErrors) {
        validatePhone.mockRejectedValueOnce(technicalError);
        await expect(
          consumer.processNotificationMessage({
            notification_id: 'notification-technical-redrive',
            message_key: { phone_ddi: '55', phone_number: '11999999999' },
            message_whatsapp: 'notification body',
          })
        ).rejects.toMatchObject({
          name: 'MessageUpdatePublishFailedError',
          originalCause: technicalError,
        });
      }

      expect(validatePhone).toHaveBeenCalledTimes(technicalErrors.length);
      expect(claimOperation).toHaveBeenCalledTimes(technicalErrors.length);
      expect(releaseReservation).toHaveBeenCalledTimes(technicalErrors.length);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'rejects malformed %s notification values in the parser instead of creating an infinite technical poison record',
    (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const base = {
        notification_id: 'notification-valid',
        message_key: { phone_ddi: '55', phone_number: '11999999999' },
        message_whatsapp: 'notification body',
      };
      const malformed = [
        { ...base, notification_id: 123 },
        { ...base, message_whatsapp: { text: 'not a string' } },
        {
          ...base,
          message_key: { phone_ddi: 55, phone_number: '11999999999' },
        },
        {
          ...base,
          message_key: {
            remote_jid: 5511999999999,
            phone_ddi: '55',
            phone_number: '11999999999',
          },
        },
        { ...base, message_key: { remote_jid: 'not-a-jid' } },
        {
          ...base,
          message_key: { phone_ddi: 'country', phone_number: 'phone' },
        },
        { ...base, operation_id: 123 },
        { ...base, account: { id: 123 } },
      ];

      for (const payload of malformed) {
        expect(
          consumer.parseNotificationMessage(
            Buffer.from(JSON.stringify(payload), 'utf8')
          )
        ).toBeNull();
      }
      expect(
        consumer.parseNotificationMessage(
          Buffer.from(JSON.stringify(base), 'utf8')
        )
      ).toEqual(base);
    }
  );

  it.each(providerCases)(
    'terminally discards a %s immutable identity conflict without invoking the provider',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'error',
        reason: 'identity_conflict',
      }));

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-conflict',
          message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
          message_whatsapp: 'body',
        })
      ).resolves.toBeUndefined();

      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'keeps a %s Redis claim outage uncommitted without invoking the provider',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'error',
        reason: 'redis_unavailable',
      }));

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-redis-outage',
          message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'keeps a %s runtime-scope capture outage uncommitted before Redis, validation, or provider work',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const captureFailure = new Error('runtime fence Redis unavailable');
      const claimOperation = jest.fn();
      const validatePhone = jest.fn();
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const incomingProperty =
        _providerName === 'Baileys'
          ? 'baileysIncomingMessageService'
          : 'wwebjsIncomingMessageService';
      consumer[incomingProperty] = {
        captureActiveConnectionScope: jest.fn(async () => {
          throw captureFailure;
        }),
      };
      consumer[validationProperty] = { validatePhone };
      consumer[senderProperty] = { sendText };
      consumer.messageSendIdempotencyService = { claimOperation };

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-capture-outage',
          message_key: {
            phone_ddi: '55',
            phone_number: '11999999999',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: captureFailure,
      });

      expect(claimOperation).not.toHaveBeenCalled();
      expect(validatePhone).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(terminalDuplicateCases)(
    'consumes a terminal duplicate for %s without invoking the provider',
    async (
      _providerName,
      Consumer,
      _validationProperty,
      senderProperty,
      duplicateState
    ) => {
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'duplicate',
        state: duplicateState,
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'notification-terminal',
        key: 'notification-terminal-key',
        owner: null,
        result: null,
      }));

      await expect(
        consumer.processNotificationMessage({
          operation_id: 'notification-terminal',
          notification_id: 'notification-terminal',
          account: { id: 'account-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).resolves.toBeUndefined();

      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(legacyDuplicateCases)(
    'terminalizes a legacy/corrupt %s %s notification without a second provider call',
    async (
      providerName,
      Consumer,
      _validationProperty,
      senderProperty,
      duplicateState,
      result
    ) => {
      const operationId = `notification-legacy-${providerName}-${duplicateState}`;
      const payload = {
        operation_id: operationId,
        notification_id: `notification-${duplicateState}`,
        account: { id: 'account-1' },
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
        },
        message_whatsapp: 'body',
      };
      const recoverLegacyAmbiguous = jest.fn(async () => 'transitioned');
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, providerName);
      consumer.messageSendIdempotencyService = { recoverLegacyAmbiguous };
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'duplicate',
        state: duplicateState,
        accountId: 'account-1',
        operationType: 'notification',
        operationId,
        key: `${operationId}-key`,
        owner: null,
        result,
      }));

      await expect(
        consumer.processNotificationMessage(payload)
      ).resolves.toBeUndefined();

      expect(sendText).not.toHaveBeenCalled();
      expect(recoverLegacyAmbiguous).toHaveBeenCalledWith(
        expect.objectContaining({
          state: duplicateState,
          operationId,
        }),
        expect.objectContaining({
          schema_version: 'notification_send_ambiguous_recovery_v1',
          operation_id: operationId,
        }),
        {
          provider: providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          worker_id: 'worker-1',
          notification_id: payload.notification_id,
          destination: 'jid:5511999999999@s.whatsapp.net',
        },
        ['runtime_generation', 'connection_epoch', 'consumer_assignment_epoch']
      );
    }
  );

  it.each(providerCases)(
    'keeps a live %s provider-invoked notification uncommitted without recovery publication',
    async (providerName, Consumer, _validationProperty, senderProperty) => {
      const operationId = `notification-live-${providerName}`;
      const sendText = jest.fn();
      const recoverLegacyAmbiguous = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, providerName);
      consumer.messageSendIdempotencyService = { recoverLegacyAmbiguous };
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'duplicate',
        state: 'provider_invoked',
        accountId: 'account-1',
        operationType: 'notification',
        operationId,
        key: `${operationId}-key`,
        owner: null,
        result: null,
      }));

      await expect(
        consumer.processNotificationMessage({
          operation_id: operationId,
          notification_id: operationId,
          account: { id: 'account-1' },
          message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).not.toHaveBeenCalled();
      expect(recoverLegacyAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each(legacyRecoveryFailureCases)(
    'keeps the %s offset uncommitted when legacy ambiguous CAS returns %s',
    async (
      providerName,
      Consumer,
      _validationProperty,
      senderProperty,
      transitionStatus
    ) => {
      const operationId = `notification-legacy-failure-${transitionStatus}`;
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, providerName);
      consumer.messageSendIdempotencyService = {
        recoverLegacyAmbiguous: jest.fn(async () => transitionStatus),
      };
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'duplicate',
        state: 'ambiguous',
        accountId: 'account-1',
        operationType: 'notification',
        operationId,
        key: `${operationId}-key`,
        owner: null,
        result: null,
      }));

      await expect(
        consumer.processNotificationMessage({
          operation_id: operationId,
          notification_id: operationId,
          account: { id: 'account-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'terminally discards a legacy %s recovery identity conflict without invoking the provider',
    async (providerName, Consumer, _validationProperty, senderProperty) => {
      const operationId = `notification-legacy-conflict-${providerName}`;
      const sendText = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, providerName);
      consumer.messageSendIdempotencyService = {
        recoverLegacyAmbiguous: jest.fn(async () => 'identity_conflict'),
      };
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => ({
        status: 'duplicate',
        state: 'ambiguous',
        accountId: 'account-1',
        operationType: 'notification',
        operationId,
        key: `${operationId}-key`,
        owner: null,
        result: null,
      }));
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.processNotificationMessage({
            operation_id: operationId,
            notification_id: operationId,
            account: { id: 'account-1' },
            message_key: {
              remote_jid: '5511999999999@s.whatsapp.net',
            },
            message_whatsapp: 'body',
          })
        ).resolves.toBeUndefined();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'does not complete a %s offset when the acquired effect lease enters fence draining before scope capture',
    async (providerName, Consumer, _validationProperty, senderProperty) => {
      const sendText = jest.fn();
      const claimNotificationSendAttempt = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      const { property } = attachActiveScope(consumer, providerName);
      consumer[property].captureActiveConnectionScope = jest.fn(
        async () => null
      );
      consumer[senderProperty] = { sendText };
      consumer.claimNotificationSendAttempt = claimNotificationSendAttempt;

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-fence-draining',
          account: { id: 'account-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(claimNotificationSendAttempt).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each(uncertainPersistenceCases)(
    'keeps a %s post-provider uncertain transition uncommitted after exactly one provider call',
    async (
      _providerName,
      Consumer,
      _validationProperty,
      senderProperty,
      transitionStatus
    ) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: `notification-${transitionStatus}`,
        key: `notification-${transitionStatus}-key`,
        owner: 'owner-1',
        result: null,
      };
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
          providerCall();
          throw new Error('provider_ack_unknown');
        }
      );
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => transitionStatus),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          operation_id: claim.operationId,
          notification_id: `notification-${transitionStatus}`,
          account: { id: 'account-1' },
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({ message: 'provider_ack_unknown' }),
        expect.objectContaining({
          schema_version: 'notification_send_ambiguous_recovery_v1',
          provider: _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          operation_id: claim.operationId,
        })
      );
    }
  );

  it.each(recoverableDuplicateCases)(
    'recovers a crashed %s notification boundary without invoking the provider twice',
    async (
      _providerName,
      Consumer,
      _validationProperty,
      senderProperty,
      duplicateState
    ) => {
      const operationId = `notification-crash-${_providerName}`;
      const payload = {
        operation_id: operationId,
        notification_id: operationId,
        account: { id: 'account-1' },
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
        },
        message_whatsapp: 'body',
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId,
        key: `${operationId}-key`,
        owner: 'owner-crash',
        result: null,
      };
      let providerBoundaryRecovery: unknown = null;
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
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
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest
        .fn()
        .mockResolvedValueOnce(claim)
        .mockImplementationOnce(async () => ({
          ...claim,
          status: 'duplicate',
          state: duplicateState,
          owner: null,
          result: providerBoundaryRecovery,
        }));

      await expect(
        consumer.processNotificationMessage(payload)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.processNotificationMessage(payload)
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledTimes(1);
      expect(providerBoundaryRecovery).toEqual(
        expect.objectContaining({
          schema_version: 'notification_send_ambiguous_recovery_v1',
          operation_id: operationId,
        })
      );
    }
  );

  it.each(providerCases)(
    'reverses the %s provider claim and does not start the provider when dispatch is revoked immediately after the CAS',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'notification-fenced',
        key: 'notification-fenced-key',
        owner: 'owner-1',
        result: null,
      };
      const providerCall = jest.fn();
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      let providerMarked = false;
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (providerMarked) {
          throw dispatchRevoked;
        }
      });
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
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
          providerCall();
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage(
          {
            notification_id: 'notification-fenced',
            message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
            message_whatsapp: 'body',
          },
          assertDispatchActive
        )
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: dispatchRevoked,
      });

      expect(providerCall).not.toHaveBeenCalled();
      expect(idempotency.markProviderInvoked).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          schema_version: 'notification_send_ambiguous_recovery_v1',
          provider: _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          notification_id: 'notification-fenced',
        }),
        expect.any(Number)
      );
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'keeps the %s notification fail-closed without starting the provider when the post-CAS reversal is uncertain',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'notification-fenced-uncertain',
        key: 'notification-fenced-uncertain-key',
        owner: 'owner-uncertain',
        result: null,
      };
      const providerCall = jest.fn();
      let providerMarked = false;
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (providerMarked) {
          throw new KafkaConsumerDispatchRevokedError();
        }
      });
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
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
          providerCall();
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage(
          {
            notification_id: 'notification-fenced-uncertain',
            message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
            message_whatsapp: 'body',
          },
          assertDispatchActive
        )
      ).resolves.toBeUndefined();

      expect(providerCall).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).toHaveBeenCalledTimes(1);
    }
  );

  it.each(providerCases)(
    'redrives a disconnected %s provider preflight before the boundary',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'notification-1\0jid:5511999999999@s.whatsapp.net',
        key: 'notification-key',
        owner: 'owner-1',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerUnavailable = new Error(
        _providerName === 'Baileys'
          ? 'Socket not connected'
          : 'Wwebjs client not connected'
      );
      const sendText = jest.fn(async () => {
        throw providerUnavailable;
      });
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          notification_id: 'notification-1',
          message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
          message_whatsapp: 'body',
        })
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: providerUnavailable,
      });

      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'owner-safely reverses and redrives a %s provider replacement after the CAS without an SDK call',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'notification-provider-replaced',
        key: 'notification-provider-replaced-key',
        owner: 'owner-provider-replaced',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerReplaced = new Error('provider instance replaced');
      const providerSdkCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          boundary: {
            (): Promise<void>;
            onStartRejected?: (error: unknown) => Promise<void>;
          }
        ) => {
          await boundary();
          await boundary.onStartRejected?.(providerReplaced);
          throw providerReplaced;
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          operation_id: 'notification-provider-replaced',
          notification_id: 'notification-provider-replaced',
          message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
          message_whatsapp: 'body',
        })
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: providerReplaced,
      });

      expect(providerSdkCall).not.toHaveBeenCalled();
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'redelivers a %s notification fenced on the stalled provider scope without terminal state',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: `notification-stalled-${_providerName}`,
        key: `notification-stalled-key-${_providerName}`,
        owner: 'owner-stalled',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const sendText = jest.fn(async () => {
        throw new ProviderInvocationInFlightError();
      });
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.resolveNotificationTarget = jest.fn(async () => ({
        jid: '5511999999999@s.whatsapp.net',
        resolvedFromPhone: false,
        connectionScope: scope,
      }));
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          notification_id: `notification-stalled-${_providerName}`,
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'defers the %s phone JID update until after the provider ACK is durable',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const streamProducerService = { send: jest.fn() };
      const sendText = jest.fn(async () => undefined);
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      consumer[senderProperty] = { sendText };
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        userPhoneJidUpdate: jest.fn(() => 'user.phone-jid.update'),
      };

      await expect(
        consumer.sendNotificationMessage(
          {
            notification_id: 'notification-phone-jid-fenced',
            user_id: 'user-1',
            message_key: {
              phone_ddi: '55',
              phone_number: '11999999999',
            },
            message_whatsapp: 'body',
          },
          {
            jid: '5511999999999@s.whatsapp.net',
            resolvedFromPhone: true,
            connectionScope: scope,
          },
          jest.fn(async () => undefined)
        )
      ).resolves.toBeUndefined();

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'does not accept a %s phone-validation result after assignment revocation',
    async (_providerName, Consumer, validationProperty) => {
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      let validationResolved = false;
      consumer[validationProperty] = {
        validatePhone: jest.fn(async () => {
          validationResolved = true;
          return {
            valid: true,
            jid: '5511999999999@s.whatsapp.net',
          };
        }),
      };
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (validationResolved) {
          throw dispatchRevoked;
        }
      });

      await expect(
        consumer.resolveNotificationTarget(
          {
            notification_id: 'notification-validation-fenced',
            message_key: {
              phone_ddi: '55',
              phone_number: '11999999999',
            },
            message_whatsapp: 'body',
          },
          scope,
          assertDispatchActive
        )
      ).rejects.toBe(dispatchRevoked);

      expect(assertDispatchActive).toHaveBeenCalledTimes(2);
    }
  );

  it.each(providerCases)(
    'rejects a %s remote-JID notification when the connection epoch changes before the provider boundary',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'operation-remote',
        key: 'notification-remote-key',
        owner: 'owner-remote',
        result: null,
      };
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
          providerCall();
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      const { property, scope } = attachActiveScope(consumer, _providerName);
      consumer[property].captureActiveConnectionScope = jest
        .fn()
        .mockResolvedValueOnce(scope)
        .mockResolvedValue({
          ...scope,
          connection_epoch: 'epoch-2',
        });
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          operation_id: 'operation-remote',
          notification_id: 'notification-remote',
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(providerCall).not.toHaveBeenCalled();
      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'persists a known %s remote-JID ACK before observing a later epoch change',
    async (_providerName, Consumer, _validationProperty, senderProperty) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification',
        operationId: 'operation-post-provider',
        key: 'notification-post-provider-key',
        owner: 'owner-post-provider',
        result: null,
      };
      const providerCall = jest.fn();
      const sendText = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
          providerCall();
        }
      );
      const consumer = Object.create(Consumer.prototype) as any;
      const { property, scope } = attachActiveScope(consumer, _providerName);
      consumer[property].captureActiveConnectionScope = jest
        .fn()
        .mockResolvedValueOnce(scope)
        .mockResolvedValueOnce(scope)
        .mockResolvedValueOnce(scope)
        .mockResolvedValue({
          ...scope,
          connection_epoch: 'epoch-2',
        });
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer[senderProperty] = { sendText };
      consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

      await expect(
        consumer.processNotificationMessage({
          operation_id: 'operation-post-provider',
          notification_id: 'notification-post-provider',
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
          },
          message_whatsapp: 'body',
        })
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          schema_version: 'notification_send_ambiguous_recovery_v1',
        }),
        expect.any(Number)
      );
      expect(idempotency.markSucceeded).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          notification_id: 'notification-post-provider',
        })
      );
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
    }
  );

  it.each(providerCases)(
    'publishes %s phone JID updates with entity key and runtime metadata',
    async (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = attachActiveScope(consumer, _providerName);
      const streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        userPhoneJidUpdate: jest.fn(() => 'user.phone.jid.update'),
      };
      const accountId =
        _providerName === 'Baileys'
          ? 'fallback-baileys-account'
          : 'fallback-wwebjs-account';
      const operationId = 'operation-1';
      const phoneJid = '5511999999999@s.whatsapp.net';
      const assertDispatchActive = jest.fn();
      const eventId = buildUserPhoneJidUpdateEventId({
        account_id: accountId,
        worker_id: 'worker-1',
        operation_id: operationId,
        user_id: 'user-1',
        phone_jid: phoneJid,
      });

      await consumer.sendPhoneJidRecoveryRequest(
        buildNotificationPhoneJidRecovery({
          provider: _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          operationId,
          notificationId: 'notification-1',
          destination: 'phone:55:11999999999',
          accountId,
          workerId: 'worker-1',
          userId: 'user-1',
          phoneJid,
        }),
        scope,
        assertDispatchActive
      );

      expect(streamProducerService.send).toHaveBeenCalledWith(
        'user.phone.jid.update',
        {
          user_id: 'user-1',
          phone_jid: phoneJid,
          account_id: accountId,
          worker_id: 'worker-1',
          operation_id: operationId,
          event_id: eventId,
          source_provider: _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
          runtime_generation: 7,
          connection_epoch: 'epoch-1',
        },
        'user-1',
        undefined,
        assertDispatchActive
      );
    }
  );

  it.each(providerCases)(
    'replays a durable %s phone-JID event after auxiliary failure without validating or invoking the provider twice',
    async (_providerName, Consumer, validationProperty, senderProperty) => {
      const accountId =
        _providerName === 'Baileys'
          ? 'fallback-baileys-account'
          : 'fallback-wwebjs-account';
      const provider = _providerName === 'Baileys' ? 'baileys' : 'wwebjs';
      const operationId = 'notification-phone-jid-recovery';
      const phoneJid = '5511999999999@s.whatsapp.net';
      const payload = {
        operation_id: operationId,
        notification_id: 'notification-phone-jid-recovery',
        user_id: 'user-recovery',
        message_key: {
          phone_ddi: '55',
          phone_number: '11999999999',
        },
        message_whatsapp: 'body',
      };
      const recovery = buildNotificationPhoneJidRecovery({
        provider,
        operationId,
        notificationId: payload.notification_id,
        destination: 'phone:55:11999999999',
        accountId,
        workerId: 'worker-1',
        userId: payload.user_id,
        phoneJid,
      });
      const acquired = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'notification',
        operationId,
        key: 'notification-phone-jid-recovery-key',
        owner: 'notification-phone-jid-recovery-owner',
        result: null,
      };
      const duplicate = {
        ...acquired,
        status: 'duplicate',
        state: 'succeeded',
        owner: null,
        result: recovery,
      };
      const claimOperation = jest
        .fn()
        .mockResolvedValueOnce(acquired)
        .mockResolvedValueOnce(duplicate);
      const markSucceeded = jest.fn(async () => 'transitioned');
      const idempotency = {
        claimOperation,
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded,
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const validatePhone = jest.fn(async () => ({
        valid: true,
        jid: phoneJid,
      }));
      const providerSend = jest.fn(
        async (
          _jid: string,
          _text: string,
          _options: unknown,
          beforeProviderInvoke: () => Promise<void>
        ) => {
          await beforeProviderInvoke();
        }
      );
      const auxiliaryUnavailable = new Error('auxiliary Kafka unavailable');
      const streamProducerService = {
        send: jest
          .fn()
          .mockRejectedValueOnce(auxiliaryUnavailable)
          .mockResolvedValueOnce(undefined),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      attachActiveScope(consumer, _providerName);
      consumer[validationProperty] = { validatePhone };
      consumer[senderProperty] = { sendText: providerSend };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        userPhoneJidUpdate: jest.fn(() => 'user.phone.jid.update'),
      };

      await expect(
        consumer.processNotificationMessage(payload)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: auxiliaryUnavailable,
      });
      await expect(
        consumer.processNotificationMessage(payload)
      ).resolves.toBeUndefined();

      expect(validatePhone).toHaveBeenCalledTimes(1);
      expect(providerSend).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(markSucceeded).toHaveBeenCalledWith(acquired, recovery);
      expect(recovery.phone_jid_event_id).toBeTruthy();
      expect(streamProducerService.send).toHaveBeenCalledTimes(2);
      const firstEvent = streamProducerService.send.mock.calls[0]?.[1];
      const replayedEvent = streamProducerService.send.mock.calls[1]?.[1];
      expect(firstEvent).toEqual(
        expect.objectContaining({
          event_id: recovery.phone_jid_event_id,
          operation_id: operationId,
          user_id: payload.user_id,
          phone_jid: phoneJid,
        })
      );
      expect(replayedEvent).toEqual(firstEvent);
      expect(streamProducerService.send.mock.calls[0]?.[2]).toBe(
        payload.user_id
      );
      expect(streamProducerService.send.mock.calls[1]?.[2]).toBe(
        payload.user_id
      );
    }
  );

  it.each(providerCases)(
    'keeps a %s phone JID update uncommitted after its connection epoch is replaced',
    async (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const { property, scope } = attachActiveScope(consumer, _providerName);
      consumer[property].captureActiveConnectionScope = jest.fn(async () => ({
        ...scope,
        connection_epoch: 'epoch-2',
      }));
      const streamProducerService = { send: jest.fn() };
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        userPhoneJidUpdate: jest.fn(() => 'user.phone.jid.update'),
      };

      await expect(
        consumer.sendPhoneJidRecoveryRequest(
          buildNotificationPhoneJidRecovery({
            provider: _providerName === 'Baileys' ? 'baileys' : 'wwebjs',
            operationId: 'operation-1',
            notificationId: 'notification-1',
            destination: 'phone:55:11999999999',
            accountId:
              _providerName === 'Baileys'
                ? 'fallback-baileys-account'
                : 'fallback-wwebjs-account',
            workerId: 'worker-1',
            userId: 'user-1',
            phoneJid: '5511999999999@s.whatsapp.net',
          }),
          scope,
          jest.fn()
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it('marks the WWebJS notification ambiguous after the boundary and never releases it', async () => {
    const claim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'notification',
      operationId: 'notification-2\0jid:5511999999999@c.us',
      key: 'notification-key-2',
      owner: 'owner-2',
      result: null,
    };
    const idempotency = {
      markProviderInvoked: jest.fn(async () => 'transitioned'),
      markSucceeded: jest.fn(async () => 'transitioned'),
      markAmbiguous: jest.fn(async () => 'transitioned'),
      releaseReservation: jest.fn(async () => 'transitioned'),
    };
    const sendText = jest.fn(
      async (
        _jid: string,
        _text: string,
        _options: unknown,
        beforeProviderInvoke: () => Promise<void>
      ) => {
        await beforeProviderInvoke();
        throw new Error('provider timeout');
      }
    );
    const consumer = Object.create(
      NotificationMessageSendWwebjsConsume.prototype
    ) as any;
    const { scope } = attachActiveScope(consumer, 'WWebJS');
    consumer.messageSendIdempotencyService = idempotency;
    consumer.wwebjsMessageTextService = { sendText };
    consumer.resolveNotificationTarget = jest.fn(async () => ({
      jid: '5511999999999@c.us',
      resolvedFromPhone: false,
      connectionScope: scope,
    }));
    consumer.claimNotificationSendAttempt = jest.fn(async () => claim);

    await expect(
      consumer.processNotificationMessage({
        notification_id: 'notification-2',
        message_key: { remote_jid: '5511999999999@c.us' },
        message_whatsapp: 'body',
      })
    ).resolves.toBeUndefined();

    expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
    expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({ message: 'provider timeout' }),
      expect.objectContaining({
        schema_version: 'notification_send_ambiguous_recovery_v1',
        provider: 'wwebjs',
      })
    );
    expect(idempotency.releaseReservation).not.toHaveBeenCalled();
  });
});
