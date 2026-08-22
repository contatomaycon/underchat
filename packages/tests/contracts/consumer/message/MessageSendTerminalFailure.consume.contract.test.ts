import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.replace(/@c\.us$/, '@s.whatsapp.net'),
  proto: {
    Message: {
      decode: jest.fn(),
      encode: jest.fn(() => ({ finish: () => Buffer.from('') })),
    },
    WebMessageInfo: {
      Status: {},
    },
  },
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-baileys',
    baileysWorkerId: 'worker-baileys',
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-wwebjs',
    wwebjsWorkerId: 'worker-wwebjs',
  },
}));

jest.mock('@core/services/baileys/methods/messageText.service', () => ({
  BaileysMessageTextService: class BaileysMessageTextService {},
}));

jest.mock('@core/services/baileys/methods/messageMedia.service', () => ({
  BaileysMessageMediaService: class BaileysMessageMediaService {},
}));

jest.mock(
  '@core/services/baileys/methods/messageReactionsInteractions.service',
  () => ({
    BaileysMessageReactionsInteractionsService: class BaileysMessageReactionsInteractionsService {},
  })
);

jest.mock('@core/services/baileys/methods/messageEditDelete.service', () => ({
  BaileysMessageEditDeleteService: class BaileysMessageEditDeleteService {},
}));

jest.mock(
  '@core/services/baileys/methods/messageLocationContact.service',
  () => ({
    BaileysMessageLocationContactService: class BaileysMessageLocationContactService {},
  })
);

jest.mock(
  '@core/services/baileys/methods/messageStatusStories.service',
  () => ({
    BaileysMessageStatusStoriesService: class BaileysMessageStatusStoriesService {},
  })
);

jest.mock('@core/services/baileys/methods/profile.service', () => ({
  BaileysProfileService: class BaileysProfileService {},
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

jest.mock(
  '@core/services/wwebjs/methods/messageReactionsInteractions.service',
  () => ({
    WwebjsMessageReactionsInteractionsService: class WwebjsMessageReactionsInteractionsService {},
  })
);

jest.mock('@core/services/wwebjs/methods/messageEditDelete.service', () => ({
  WwebjsMessageEditDeleteService: class WwebjsMessageEditDeleteService {},
}));

jest.mock(
  '@core/services/wwebjs/methods/messageLocationContact.service',
  () => ({
    WwebjsMessageLocationContactService: class WwebjsMessageLocationContactService {},
  })
);

jest.mock('@core/services/wwebjs/methods/messageStatusStories.service', () => ({
  WwebjsMessageStatusStoriesService: class WwebjsMessageStatusStoriesService {},
}));

jest.mock('@core/services/wwebjs/methods/profile.service', () => ({
  WwebjsProfileService: class WwebjsProfileService {},
}));

jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

jest.mock('@core/services/wwebjs/util/buildForwardExtraOptions', () => ({
  buildForwardExtraOptions: jest.fn(() => ({})),
}));

import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';
import { MessageUpdatePublishFailedError } from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { buildMessageUpdateEventId } from '@core/common/functions/messageUpdateIdentity';
import { ProviderInvocationInFlightError } from '@core/common/functions/providerInvocationSingleFlight';

function makeMessageStatusService() {
  return {
    isMessageAlreadySentByMessageId: jest.fn(async () => false),
    markMessageAsNotSent: jest.fn(async () => undefined),
  };
}

function makeEnvelope(
  payload: unknown = {
    message_id: 'message-1',
    chat_id: '5511999999999@s.whatsapp.net',
    message_key: {
      remote_jid: '5511999999999@s.whatsapp.net',
      from_me: true,
      is_view_once: false,
    },
    account: { id: 'account-1' },
  }
) {
  return {
    sourceTopic: 'worker.w1.send.message',
    partition: 2,
    offset: 41,
    kafkaKey: 'message-1',
    payload,
    queueKey: 'account-1:chat-1',
    chatId: 'chat-1',
    assertDispatchActive: () => undefined,
  };
}

function makeScopedEnvelope(provider: 'baileys' | 'wwebjs') {
  const envelope = makeEnvelope();
  const payload = envelope.payload as Record<string, unknown>;
  return {
    ...envelope,
    payload: {
      ...payload,
      account: {
        id: provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
      },
      worker: {
        id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
      },
    },
  };
}

function configureConnectionScope(
  consumer: any,
  provider: 'baileys' | 'wwebjs'
) {
  const scope = {
    worker_id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
    runtime_generation: 11,
    connection_epoch: `connection-${provider}-11`,
    source_provider: provider,
    activated_at: Date.now(),
  };
  const incoming = {
    captureActiveConnectionScope: jest.fn(async () => scope),
  };
  consumer.activeSendConnectionScopes ??= new Map();
  consumer.activeSendDispatchGuards ??= new Map();
  consumer.PROVIDER = provider;
  consumer.baileysIncomingMessageService = incoming;
  consumer.wwebjsIncomingMessageService = incoming;
  return { incoming, scope };
}

describe('message send terminal failures without Kafka redrive', () => {
  it('publishes a durable Baileys terminal status before consuming a proven pre-provider failure', async () => {
    const streamProducerService = { send: jest.fn(async () => undefined) };
    const kafkaServiceQueueService = {
      updateMessageStatus: jest.fn(() => 'update.message.status'),
    };
    const messageStatusService = makeMessageStatusService();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consumer = new MessageSendConsume(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      streamProducerService as never,
      kafkaServiceQueueService as never,
      messageStatusService as never,
      {} as never
    );
    const { scope } = configureConnectionScope(consumer, 'baileys');

    try {
      await (consumer as any).routeFailedMessage(
        makeScopedEnvelope('baileys'),
        new Error('send failed'),
        'processing_failed'
      );

      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'update.message.status',
        expect.objectContaining({
          event_id: expect.stringMatching(/^message_status_v1_/),
          account_id: 'account-baileys',
          worker_id: scope.worker_id,
          source_provider: 'baileys',
          runtime_generation: scope.runtime_generation,
          connection_epoch: scope.connection_epoch,
          message_id: 'message-1',
          internal_message_id: 'message-1',
          patch: {},
          failed: true,
          key: expect.objectContaining({
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
          }),
        }),
        'account-baileys:worker-baileys:message-1',
        undefined,
        expect.any(Function)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageSend] Discarding terminal send failure:',
        expect.objectContaining({
          message_id: 'message-1',
          reason: 'processing_failed_terminal',
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('publishes a durable WWebJS terminal status before consuming a proven pre-provider failure', async () => {
    const streamProducerService = { send: jest.fn(async () => undefined) };
    const kafkaServiceQueueService = {
      updateMessageStatus: jest.fn(() => 'update.message.status'),
    };
    const messageStatusService = makeMessageStatusService();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consumer = new MessageSendWwebjsConsume(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      streamProducerService as never,
      kafkaServiceQueueService as never,
      messageStatusService as never,
      {} as never
    );
    const { scope } = configureConnectionScope(consumer, 'wwebjs');

    try {
      await (consumer as any).routeFailedMessage(
        makeScopedEnvelope('wwebjs'),
        new Error('send failed'),
        'processing_failed'
      );

      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'update.message.status',
        expect.objectContaining({
          event_id: expect.stringMatching(/^message_status_v1_/),
          account_id: 'account-wwebjs',
          worker_id: scope.worker_id,
          source_provider: 'wwebjs',
          runtime_generation: scope.runtime_generation,
          connection_epoch: scope.connection_epoch,
          message_id: 'message-1',
          internal_message_id: 'message-1',
          patch: {},
          failed: true,
          key: expect.objectContaining({
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
          }),
        }),
        'account-wwebjs:worker-wwebjs:message-1',
        undefined,
        expect.any(Function)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageSendWwebjs] Discarding terminal send failure:',
        expect.objectContaining({
          message_id: 'message-1',
          reason: 'processing_failed_terminal',
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'propagates %s dispatch revocation raised inside terminal status side effects',
    async (_providerName, Consumer) => {
      const revoked = new KafkaConsumerDispatchRevokedError();
      let isRevoked = false;
      const assertDispatchActive = jest.fn<void, []>(() => {
        if (isRevoked) {
          throw revoked;
        }
      });
      const consumer = Object.create(Consumer.prototype) as any;
      const provider =
        Consumer === MessageSendConsume ? 'baileys' : ('wwebjs' as const);
      configureConnectionScope(consumer, provider);
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.streamProducerService = {
        send: jest.fn(
          async (
            _topic: string,
            _payload: unknown,
            _key: string,
            _headers: unknown,
            guard: () => Promise<void>
          ) => {
            isRevoked = true;
            await guard();
          }
        ),
      };

      await expect(
        consumer.markMessageAsFailedToSend(
          {
            ...makeEnvelope(),
            assertDispatchActive,
          },
          makeEnvelope().payload
        )
      ).rejects.toBe(revoked);

      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'compacts a %s terminal recovery strictly after the global Kafka PubAck',
    async (_providerName, Consumer, provider) => {
      const events: string[] = [];
      const consumer = Object.create(Consumer.prototype) as any;
      configureConnectionScope(consumer, provider);
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.streamProducerService = {
        send: jest.fn(async () => {
          events.push('puback');
        }),
      };
      consumer.messageSendIdempotencyService = {
        compactTerminalAfterRecoveryPubAck: jest.fn(async () => {
          events.push('compact');
          return 'transitioned';
        }),
      };
      const payload = makeScopedEnvelope(provider).payload;
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        operationType: 'direct',
        operationId: 'message-1',
        key: `message-send:idempotency:v4:${provider}:message-1`,
        owner: 'owner-1',
        result: null,
      };

      await consumer.markMessageAsFailedToSend(
        makeScopedEnvelope(provider),
        payload,
        undefined,
        claim
      );

      expect(events).toEqual(['puback', 'compact']);
      expect(
        consumer.messageSendIdempotencyService
          .compactTerminalAfterRecoveryPubAck
      ).toHaveBeenCalledWith(
        claim,
        'failed',
        expect.objectContaining({
          schema_version: 'message_send_terminal_failure_recovery_v1',
        })
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'never compacts a %s terminal recovery when every Kafka publish attempt fails',
    async (_providerName, Consumer, provider) => {
      const publishError = new Error('kafka unavailable');
      const consumer = Object.create(Consumer.prototype) as any;
      configureConnectionScope(consumer, provider);
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.streamProducerService = {
        send: jest.fn(async () => {
          throw publishError;
        }),
      };
      consumer.delay = jest.fn(async () => undefined);
      consumer.messageSendIdempotencyService = {
        compactTerminalAfterRecoveryPubAck: jest.fn(async () =>
          Promise.resolve('transitioned')
        ),
      };
      const payload = makeScopedEnvelope(provider).payload;
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        operationType: 'direct',
        operationId: 'message-1',
        key: `message-send:idempotency:v4:${provider}:message-1`,
        owner: 'owner-1',
        result: null,
      };

      await expect(
        consumer.markMessageAsFailedToSend(
          makeScopedEnvelope(provider),
          payload,
          undefined,
          claim
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(3);
      expect(
        consumer.messageSendIdempotencyService
          .compactTerminalAfterRecoveryPubAck
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'cleans every %s active-send registry after durable success and after a post-success Kafka error',
    async (_providerName, Consumer, provider) => {
      for (const publishFails of [false, true]) {
        const accountId =
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
        const workerId =
          provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
        const payload = {
          message_id: `message-cleanup-${provider}-${publishFails}`,
          chat_id: '5511999999999@s.whatsapp.net',
          message_key: {
            remote_jid: '5511999999999@s.whatsapp.net',
            from_me: true,
          },
          account: { id: accountId },
          worker: { id: workerId },
          content: { type: EMessageType.text, message: 'cleanup' },
        };
        const claim = {
          status: 'acquired',
          state: 'reserved',
          accountId,
          operationType: 'direct',
          operationId: payload.message_id,
          key: `message-send:idempotency:v3:cleanup-${provider}-${publishFails}`,
          owner: 'cleanup-owner',
          result: null,
        };
        const consumer = Object.create(Consumer.prototype) as any;
        consumer.activeSendClaims = new Map();
        consumer.providerInvokedSendClaims = new Set();
        consumer.activeSendDispatchGuards = new Map();
        consumer.activeSendConnectionScopes = new Map();
        consumer.activeSendPreProviderDeadlines = new Map();
        consumer.activeSendProviderStartedResolvers = new Map();
        consumer.activeSendOperationOwners = new Map();
        consumer.claimMessageSend = jest.fn(async () => claim);
        const compactTerminalAfterRecoveryPubAck = jest.fn(
          async () => 'transitioned'
        );
        consumer.messageSendIdempotencyService = {
          markProviderInvoked: jest.fn(async () => 'transitioned'),
          markSucceeded: jest.fn(async () => 'transitioned'),
          releaseReservation: jest.fn(async () => 'transitioned'),
          compactTerminalAfterRecoveryPubAck,
        };
        consumer.kafkaServiceQueueService = {
          updateMessage: jest.fn(() => 'update.message'),
        };
        const publishError = new Error('message update Kafka unavailable');
        consumer.streamProducerService = {
          send: publishFails
            ? jest.fn(async () => {
                throw publishError;
              })
            : jest.fn(async () => undefined),
        };
        configureConnectionScope(consumer, provider);
        consumer.processMessageWithPreProviderDeadline = jest.fn(async () => {
          const activeSendKey = consumer.activeSendKey(payload);
          consumer.activeSendProviderStartedResolvers.set(
            activeSendKey,
            jest.fn()
          );
          await consumer.markActiveProviderInvoked(payload);
          await consumer.pushUpdate({
            message: {
              key: {
                id: `provider-cleanup-${provider}-${publishFails}`,
                remoteJid: payload.chat_id,
                fromMe: true,
              },
              message: null,
            },
            data: payload,
          });
        });

        const processed = consumer.processPayload(
          payload,
          makeEnvelope(payload)
        );
        if (publishFails) {
          await expect(processed).rejects.toMatchObject({
            name: 'MessageUpdatePublishFailedError',
            originalCause: publishError,
          });
        } else {
          await expect(processed).resolves.toBeUndefined();
        }

        if (publishFails) {
          expect(compactTerminalAfterRecoveryPubAck).not.toHaveBeenCalled();
        } else {
          expect(compactTerminalAfterRecoveryPubAck).toHaveBeenCalledWith(
            claim,
            'succeeded',
            expect.objectContaining({ update_message: expect.any(Object) })
          );
        }

        for (const registry of [
          consumer.activeSendClaims,
          consumer.providerInvokedSendClaims,
          consumer.activeSendDispatchGuards,
          consumer.activeSendConnectionScopes,
          consumer.activeSendPreProviderDeadlines,
          consumer.activeSendProviderStartedResolvers,
          consumer.activeSendOperationOwners,
        ]) {
          expect(registry.size).toBe(0);
        }
      }
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'redelivers a %s direct send fenced on the stalled provider scope without terminal failure',
    async (_providerName, Consumer, provider) => {
      const payload = {
        message_id: `message-stalled-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: {
          id: provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        },
        worker: {
          id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
        },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: payload.account.id,
        operationType: 'direct',
        operationId: payload.message_id,
        key: `message-send:idempotency:v3:stalled-${provider}`,
        owner: 'owner-stalled',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        markFailed: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.processMessage = jest.fn(async () => {
        throw new ProviderInvocationInFlightError();
      });

      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.markFailed).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'reverses a %s provider-invoked CAS and never resolves provider_started when the CAS finishes after the deadline',
    async (_providerName, Consumer) => {
      const payload = {
        message_id: 'message-post-cas-deadline-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:post-cas-deadline',
        owner: 'owner-1',
        result: null,
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      const { scope } = configureConnectionScope(
        consumer,
        Consumer === MessageSendConsume ? 'baileys' : 'wwebjs'
      );
      const activeSendKey = consumer.activeSendKey(payload);
      const providerStarted = jest.fn();
      const dispatchGuard = jest.fn(() => undefined);
      const deadlineAtMs = Date.now() + 60_000;
      const nowSpy = jest.spyOn(Date, 'now');
      consumer.RESERVATION_LEASE_MS = 30_000;
      consumer.activeSendClaims.set(activeSendKey, claim);
      consumer.activeSendDispatchGuards.set(activeSendKey, dispatchGuard);
      consumer.activeSendConnectionScopes.set(activeSendKey, scope);
      consumer.activeSendPreProviderDeadlines.set(activeSendKey, deadlineAtMs);
      consumer.activeSendProviderStartedResolvers.set(
        activeSendKey,
        providerStarted
      );
      const idempotency = {
        markProviderInvoked: jest.fn(async () => {
          nowSpy.mockReturnValue(deadlineAtMs);
          return 'transitioned';
        }),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
      };
      consumer.messageSendIdempotencyService = idempotency;

      try {
        await expect(
          consumer.providerInvocationBoundary(payload)()
        ).rejects.toThrow('message_send_pre_provider_timeout_after_claim');
      } finally {
        nowSpy.mockRestore();
      }

      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim, expect.any(Number));
      expect(providerStarted).not.toHaveBeenCalled();
      expect(consumer.providerInvokedSendClaims.has(activeSendKey)).toBe(false);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'never starts the %s SDK when the handler deadline cleans up while the provider-invoked CAS reply is still pending',
    async (_providerName, Consumer) => {
      const payload = {
        message_id: 'message-cas-reply-pending-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:cas-reply-pending',
        owner: 'owner-1',
        result: null,
      };
      let resolveProviderInvoked!: (value: string) => void;
      let notifyCasStarted!: () => void;
      const casStarted = new Promise<void>((resolve) => {
        notifyCasStarted = resolve;
      });
      const providerInvokedReply = new Promise<string>((resolve) => {
        resolveProviderInvoked = resolve;
      });
      const idempotency = {
        markProviderInvoked: jest.fn(() => {
          notifyCasStarted();
          return providerInvokedReply;
        }),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        // Model the Redis mutation landing before its response: the competing
        // reserved->failed transition must fail closed.
        markFailed: jest.fn(async () => 'invalid_state'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.PRE_PROVIDER_TIMEOUT_MS = 15;
      consumer.RESERVATION_LEASE_MS = 30_000;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(
        consumer,
        Consumer === MessageSendConsume ? 'baileys' : 'wwebjs'
      );
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload);
        providerCall();
      });

      const processing = consumer.processPayload(
        payload,
        makeEnvelope(payload)
      );
      await casStarted;
      await expect(processing).rejects.toBeInstanceOf(
        MessageUpdatePublishFailedError
      );

      resolveProviderInvoked('transitioned');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(providerCall).not.toHaveBeenCalled();
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim, 30_000);
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'Baileys',
      MessageSendConsume,
      'baileys' as const,
      'baileysProfileService',
    ],
    [
      'WWebJS',
      MessageSendWwebjsConsume,
      'wwebjs' as const,
      'wwebjsProfileService',
    ],
  ])(
    'resumes later %s profile suboperations after revocation and crash without replaying a succeeded mutation',
    async (_providerName, Consumer, provider, profileProperty) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const durableStates = new Map<string, 'succeeded'>();
      let ownerSequence = 0;
      const claimOperation = jest.fn(async (input: any) => {
        if (durableStates.get(input.operationId) === 'succeeded') {
          return {
            status: 'duplicate',
            state: 'succeeded',
            accountId: input.accountId,
            operationType: input.operationType,
            operationId: input.operationId,
            key: `profile:${input.operationId}`,
            owner: null,
            result: null,
          };
        }
        ownerSequence += 1;
        return {
          status: 'acquired',
          state: 'reserved',
          accountId: input.accountId,
          operationType: input.operationType,
          operationId: input.operationId,
          key: `profile:${input.operationId}`,
          owner: `owner-${ownerSequence}`,
          result: null,
        };
      });
      const markSucceeded = jest.fn(async (claim: any) => {
        durableStates.set(claim.operationId, 'succeeded');
        return 'transitioned';
      });
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
      const nameMutation = jest.fn();
      const statusMutation = jest.fn();
      const photoMutation = jest.fn();
      const revoked = new KafkaConsumerDispatchRevokedError();
      const crash = new Error('process crashed between profile mutations');
      let statusAttempt = 0;
      const profileService = {
        updateProfileName: jest.fn(
          async (_name: string, beforeProviderInvoke: () => Promise<void>) => {
            await beforeProviderInvoke();
            nameMutation();
          }
        ),
        updateProfileStatus: jest.fn(
          async (
            _status: string,
            beforeProviderInvoke: () => Promise<void>
          ) => {
            statusAttempt += 1;
            if (statusAttempt === 1) {
              throw revoked;
            }
            if (statusAttempt === 2) {
              throw crash;
            }
            await beforeProviderInvoke();
            statusMutation();
          }
        ),
        removeProfilePicture: jest.fn(
          async (beforeProviderInvoke: () => Promise<void>) => {
            await beforeProviderInvoke();
            photoMutation();
          }
        ),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      consumer[profileProperty] = profileService;
      configureConnectionScope(consumer, provider);
      const payload = {
        account_id: accountId,
        worker_id: workerId,
        name: 'Underchat',
        message: 'Disponível',
        photo: null,
      };
      const envelope = makeEnvelope(payload);

      await expect(consumer.processProfileInfo(payload, envelope)).rejects.toBe(
        revoked
      );
      await expect(
        consumer.processProfileInfo(payload, envelope)
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: crash,
      });
      await expect(
        consumer.processProfileInfo(payload, envelope)
      ).resolves.toBeUndefined();

      expect(nameMutation).toHaveBeenCalledTimes(1);
      expect(statusMutation).toHaveBeenCalledTimes(1);
      expect(photoMutation).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(3);
      expect(markSucceeded).toHaveBeenCalledTimes(3);
      expect(idempotency.releaseReservation).toHaveBeenCalledTimes(2);
      expect(
        new Set(claimOperation.mock.calls.map(([input]) => input.operationId))
      ).toEqual(
        new Set([
          'worker-command\u0000worker.w1.send.message\u00002\u000041\u0000profile-info:name',
          'worker-command\u0000worker.w1.send.message\u00002\u000041\u0000profile-info:status',
          'worker-command\u0000worker.w1.send.message\u00002\u000041\u0000profile-info:photo',
        ])
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'keeps a %s claim fail-closed and never starts the SDK when the post-CAS reversal is uncertain',
    async (_providerName, Consumer) => {
      const payload = {
        message_id: 'message-post-cas-revert-error-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:post-cas-revert-error',
        owner: 'owner-1',
        result: null,
      };
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const dispatchGuard = jest
        .fn<void, []>()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw dispatchRevoked;
        });
      const providerCall = jest.fn();
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(async () => 'error'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.RESERVATION_LEASE_MS = 30_000;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(
        consumer,
        Consumer === MessageSendConsume ? 'baileys' : 'wwebjs'
      );
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload);
        providerCall();
      });

      await expect(
        consumer.processPayload(payload, {
          ...makeEnvelope(payload),
          assertDispatchActive: dispatchGuard,
        })
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(providerCall).not.toHaveBeenCalled();
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledTimes(1);
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'uses collision-free %s active keys and closes a boundary over its original claim',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const first = {
        message_id: 'same-message-id',
        chat_id: 'chat-1',
        account: { id: accountId },
        worker: { id: workerId },
      };
      const second = {
        ...first,
        chat_id: 'chat-2',
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.messageSendIdempotencyService = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
      };
      const { scope } = configureConnectionScope(consumer, provider);
      const firstKey = consumer.activeSendKey(first);
      const secondKey = consumer.activeSendKey(second);
      expect(firstKey).not.toBe(secondKey);

      const originalClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: first.message_id,
        key: 'claim-key',
        owner: 'owner-original',
        result: null,
      };
      consumer.activeSendClaims.set(firstKey, originalClaim);
      consumer.activeSendDispatchGuards.set(firstKey, jest.fn());
      consumer.activeSendConnectionScopes.set(firstKey, scope);
      const originalBoundary = consumer.providerInvocationBoundary(first);

      consumer.activeSendClaims.set(firstKey, {
        ...originalClaim,
        owner: 'owner-takeover',
      });
      consumer.activeSendDispatchGuards.set(firstKey, jest.fn());

      expect(originalBoundary.isRegistered()).toBe(false);
      await expect(originalBoundary()).rejects.toThrow(
        'whatsapp_connection_scope_active_send_missing'
      );
      expect(
        consumer.messageSendIdempotencyService.markProviderInvoked
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'retries %s terminal status publication with a stable identity and returns only after Kafka ACK',
    async (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const provider =
        Consumer === MessageSendConsume ? 'baileys' : ('wwebjs' as const);
      configureConnectionScope(consumer, provider);
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.delay = jest.fn(async () => undefined);
      consumer.streamProducerService = {
        send: jest
          .fn()
          .mockRejectedValueOnce(new Error('broker unavailable'))
          .mockRejectedValueOnce(new Error('delivery report timeout'))
          .mockResolvedValueOnce(undefined),
      };
      const envelope = makeEnvelope();

      await expect(
        consumer.markMessageAsFailedToSend(envelope, envelope.payload)
      ).resolves.toBeUndefined();

      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(3);
      expect(consumer.delay).toHaveBeenNthCalledWith(1, 100);
      expect(consumer.delay).toHaveBeenNthCalledWith(2, 300);
      const attempts = consumer.streamProducerService.send.mock.calls;
      const firstEventId = (attempts[0][1] as { event_id: string }).event_id;
      expect(
        new Set(
          attempts.map(
            (call: unknown[]) => (call[1] as { event_id: string }).event_id
          )
        )
      ).toEqual(new Set([firstEventId]));
      expect(new Set(attempts.map((call: unknown[]) => call[2]))).toEqual(
        new Set([attempts[0][2]])
      );
      expect(attempts.map((call: unknown[]) => call[0])).toEqual([
        'update.message.status',
        'update.message.status',
        'update.message.status',
      ]);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'keeps the %s offset retryable when terminal status publication exhausts its bounded attempts',
    async (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const provider =
        Consumer === MessageSendConsume ? 'baileys' : ('wwebjs' as const);
      configureConnectionScope(consumer, provider);
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.delay = jest.fn(async () => undefined);
      consumer.streamProducerService = {
        send: jest.fn(async () => {
          throw new Error('Kafka ACK unavailable');
        }),
      };
      const envelope = makeEnvelope();
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.markMessageAsFailedToSend(envelope, envelope.payload)
        ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
        expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(3);
        expect(consumer.delay).toHaveBeenCalledTimes(2);
      } finally {
        consoleSpy.mockRestore();
      }
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'replays the durable %s failed outcome after a crash without invoking the provider',
    async (_providerName, Consumer, provider) => {
      const payload = makeEnvelope().payload as any;
      const consumer = Object.create(Consumer.prototype) as any;
      configureConnectionScope(consumer, provider);
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.lastMessageTypeByChatId = new Map();
      const recovery = consumer.buildTerminalFailureRecovery(payload);
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'duplicate',
        state: 'failed',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:failed-replay',
        owner: null,
        result: recovery,
      }));
      consumer.messageSendIdempotencyService = {
        markProviderInvoked: jest.fn(),
      };
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: () => 'update.message.status',
      };
      consumer.streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.processMessage = jest.fn();
      const envelope = makeEnvelope(payload) as ReturnType<
        typeof makeEnvelope
      > & {
        connectionScopeCaptured?: boolean;
        connectionScope?: unknown;
      };

      await expect(
        consumer.processPayload(payload, envelope)
      ).resolves.toBeUndefined();

      expect(consumer.processMessage).not.toHaveBeenCalled();
      expect(
        consumer.messageSendIdempotencyService.markProviderInvoked
      ).not.toHaveBeenCalled();
      expect(consumer.streamProducerService.send).toHaveBeenCalledWith(
        'update.message.status',
        expect.objectContaining({
          event_id: recovery.status_update.event_id,
          internal_message_id: payload.message_id,
          failed: true,
        }),
        expect.any(String),
        undefined,
        expect.any(Function)
      );
    }
  );

  it.each([
    [
      'Baileys delete',
      MessageSendConsume,
      'baileys' as const,
      EMessageType.delete_message,
    ],
    [
      'WWebJS delete',
      MessageSendWwebjsConsume,
      'wwebjs' as const,
      EMessageType.delete_message,
    ],
    [
      'WWebJS reaction',
      MessageSendWwebjsConsume,
      'wwebjs' as const,
      EMessageType.react,
    ],
  ])(
    'treats a succeeded %s as terminal after a crash before the Kafka offset commit',
    async (_operationName, Consumer, provider, operationKind) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        message_id: `message-no-update-${provider}-${operationKind}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          id: 'provider-message-to-mutate',
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: accountId },
        worker: { id: workerId },
        content: {
          type: operationKind,
          message: operationKind === EMessageType.react ? '🔥' : undefined,
        },
      };
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: payload.message_id,
        key: `message-send:idempotency:v3:${payload.message_id}`,
        owner: 'owner-1',
        result: null,
      };
      let persistedResult: unknown;
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async (_claim: unknown, result: unknown) => {
          persistedResult = result;
          return 'transitioned';
        }),
        markAmbiguous: jest.fn(async () => 'invalid_state'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.lastMessageTypeByChatId = new Map();
      consumer.PRE_PROVIDER_TIMEOUT_MS = 30_000;
      consumer.PROVIDER_DEADLINE_RESERVE_MS = 120_000;
      consumer.messageSendIdempotencyService = idempotency;
      consumer.streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
      };
      configureConnectionScope(consumer, provider);
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockImplementationOnce(async () => ({
          ...acquiredClaim,
          status: 'duplicate',
          state: 'succeeded',
          owner: null,
          result: persistedResult,
        }))
        .mockResolvedValueOnce({
          ...acquiredClaim,
          status: 'duplicate',
          state: 'succeeded',
          owner: null,
          result: null,
        });
      const providerCall = jest.fn();
      consumer.processMessageWithPreProviderDeadline = jest.fn(
        async (data: typeof payload) => {
          await consumer.markActiveProviderInvoked(data);
          providerCall();
        }
      );

      // The first delivery reaches the provider and persists success. A process
      // crash before the Kafka commit makes the same record arrive again.
      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).resolves.toBeUndefined();
      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).resolves.toBeUndefined();

      // Existing v3 records stored before the explicit marker used null.
      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(
        consumer.processMessageWithPreProviderDeadline
      ).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
      expect(persistedResult).toEqual({
        no_update_required: {
          schema_version: 'message_send_no_update_required_v1',
          provider,
          operation_kind: operationKind,
          operation_id: payload.message_id,
          account_id: accountId,
          worker_id: workerId,
          chat_id: payload.chat_id,
          message_id: payload.message_id,
        },
      });
      expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'terminalizes a conflicting immutable %s identity without invoking the provider or pinning Kafka',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        hash: 'reused-business-operation',
        message_id: `message-conflict-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          id: `provider-conflict-${provider}`,
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: accountId },
        worker: { id: workerId },
        content: { type: EMessageType.text, message: 'must not be sent' },
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.claimMessageSend = jest.fn(async () => ({
        status: 'error',
        reason: 'identity_conflict',
        state: null,
        accountId,
        operationType: 'direct',
        operationId: payload.hash,
        key: 'message-send:idempotency:v3:conflict',
        owner: null,
        result: null,
      }));
      consumer.processMessage = jest.fn(async () => undefined);
      consumer.streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: jest.fn(() => 'update.message.status'),
      };
      configureConnectionScope(consumer, provider);
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.processPayload(payload, makeEnvelope(payload))
        ).resolves.toBeUndefined();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(consumer.processMessage).not.toHaveBeenCalled();
      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(1);
      expect(consumer.streamProducerService.send).toHaveBeenCalledWith(
        'update.message.status',
        expect.objectContaining({
          account_id: accountId,
          worker_id: workerId,
          source_provider: provider,
          message_id: payload.message_id,
          internal_message_id: payload.message_id,
          failed: true,
          terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
          event_id: expect.stringMatching(/^message_status_v1_/),
        }),
        `${accountId}:${workerId}:${payload.message_id}`,
        undefined,
        expect.any(Function)
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'claims the %s direct send with a reservation lease that covers the pre-provider budget',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        message_id: `message-budget-lease-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: accountId },
        worker: { id: workerId },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claimOperation = jest.fn(async () => ({
        status: 'acquired',
        state: 'reserved',
      }));
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.PROVIDER = provider;
      consumer.RESERVATION_LEASE_MS = 190_000;
      consumer.messageSendIdempotencyService = { claimOperation };
      const { scope } = configureConnectionScope(consumer, provider);

      await consumer.claimMessageSend(makeEnvelope(payload), payload, scope);

      expect(claimOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationLeaseMs: 190_000,
        })
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps the %s provider boundary open through a 60s optional typing/config budget and invokes the provider once',
    async (_providerName, Consumer, provider) => {
      jest.useFakeTimers({ now: 1_000 });
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        message_id: `message-long-typing-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          id: `provider-message-${provider}`,
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: accountId },
        worker: { id: workerId },
        content: { type: EMessageType.delete_message },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: payload.message_id,
        key: `message-send:idempotency:v3:long-typing-${provider}`,
        owner: 'owner-long-typing',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        markFailed: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.lastMessageTypeByChatId = new Map();
      consumer.PRE_PROVIDER_TIMEOUT_MS = 160_000;
      consumer.PROVIDER_INVOCATION_LEASE_MS = 75_000;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.processMessage = jest.fn(async (data: typeof payload) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 60_000);
        });
        const boundary = consumer.providerInvocationBoundary(data);
        expect(boundary.deadlineAtMs).toBe(161_000);
        await boundary();
        providerCall();
      });

      try {
        const processing = consumer.processPayload(
          payload,
          makeEnvelope(payload)
        );
        await jest.advanceTimersByTimeAsync(60_000);
        await expect(processing).resolves.toBeUndefined();

        expect(providerCall).toHaveBeenCalledTimes(1);
        expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
        expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
        expect(idempotency.markFailed).not.toHaveBeenCalled();
        expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps succeeded %s text recovery fail-closed when the provider result is missing',
    async (_providerName, Consumer, provider) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const payload = {
        message_id: `message-missing-update-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: {
          id: provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        },
        worker: {
          id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
        },
        content: { type: EMessageType.text, message: 'hello' },
      };

      await expect(
        consumer.recoverSucceededUpdate(null, payload, jest.fn())
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.recoverSucceededUpdate(
          {
            no_update_required: {
              schema_version: 'message_send_no_update_required_v1',
              provider,
              operation_kind: EMessageType.delete_message,
              operation_id: payload.message_id,
              account_id: payload.account.id,
              worker_id: payload.worker.id,
              chat_id: payload.chat_id,
              message_id: payload.message_id,
            },
          },
          payload,
          jest.fn()
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps duplicate %s reserved/provider-invoked records uncommitted without provider replay',
    async (_providerName, Consumer, provider) => {
      const payload = makeEnvelope().payload as any;

      for (const state of ['reserved', 'provider_invoked'] as const) {
        const consumer = Object.create(Consumer.prototype) as any;
        consumer.activeSendClaims = new Map();
        consumer.providerInvokedSendClaims = new Set();
        consumer.lastMessageTypeByChatId = new Map();
        configureConnectionScope(consumer, provider);
        consumer.claimMessageSend = jest.fn(async () => ({
          status: 'duplicate',
          state,
          accountId: 'account-1',
          operationType: 'direct',
          operationId: payload.message_id,
          key: `message-send:idempotency:v3:${state}`,
          owner: null,
          result: null,
        }));
        consumer.processMessage = jest.fn();

        await expect(
          consumer.processPayload(payload, makeEnvelope(payload))
        ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
        expect(consumer.processMessage).not.toHaveBeenCalled();
      }
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'treats a removed %s send guard as cancelled for every late typing task',
    (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendDispatchGuards = new Map([
        ['message-late-task', jest.fn(() => undefined)],
      ]);
      const boundary = consumer.providerInvocationBoundary('message-late-task');

      expect(boundary.isActive()).toBe(true);
      expect(boundary.isRegistered()).toBe(true);
      consumer.activeSendDispatchGuards.delete('message-late-task');
      expect(boundary.isActive()).toBe(false);
      expect(boundary.isRegistered()).toBe(false);
      expect(() => boundary.assertActive()).toThrow(
        'whatsapp_connection_scope_active_send_missing'
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'persists and replays an ambiguous %s provider outcome after a crash without invoking the provider twice',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        message_id: 'message-ambiguous-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: accountId },
        worker: { id: workerId },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:ambiguous',
        owner: 'owner-1',
        result: null,
      };
      let persistedRecovery: unknown;
      const idempotency = {
        markProviderInvoked: jest.fn(
          async (_claim: unknown, recovery: unknown) => {
            persistedRecovery = recovery;
            return 'transitioned';
          }
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(
          async (_claim: unknown, _error: unknown, recovery: unknown) => {
            persistedRecovery = recovery;
            return 'transitioned';
          }
        ),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.lastMessageTypeByChatId = new Map();
      consumer.messageSendIdempotencyService = idempotency;
      consumer.delay = jest.fn(async () => undefined);
      const { scope } = configureConnectionScope(consumer, provider);
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockImplementationOnce(async () => ({
          ...acquiredClaim,
          status: 'duplicate',
          state: 'ambiguous',
          owner: null,
          result: persistedRecovery,
        }));
      const providerError = new Error('provider acknowledgement lost');
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload);
        throw providerError;
      });
      consumer.kafkaServiceQueueService = {
        updateMessageStatus: jest.fn(() => 'update.message.status'),
      };
      consumer.streamProducerService = {
        send: jest
          .fn<Promise<void>, unknown[]>()
          .mockRejectedValueOnce(new Error('status Kafka unavailable 1'))
          .mockRejectedValueOnce(new Error('status Kafka unavailable 2'))
          .mockRejectedValueOnce(new Error('status Kafka unavailable 3'))
          .mockResolvedValueOnce(undefined),
      };
      const envelope = makeEnvelope(payload) as ReturnType<
        typeof makeEnvelope
      > & {
        connectionScopeCaptured?: boolean;
        connectionScope?: unknown;
      };
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.processPayload(payload, envelope)
        ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

        scope.runtime_generation = 12;
        scope.connection_epoch = `connection-${provider}-12`;

        await expect(
          consumer.processPayload(payload, envelope)
        ).resolves.toBeUndefined();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(consumer.processMessage).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        acquiredClaim,
        providerError,
        persistedRecovery
      );
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
      expect(persistedRecovery).toMatchObject({
        schema_version: 'message_send_ambiguous_terminal_v1',
        provider,
        operation_id: payload.message_id,
        outcome_digest: expect.any(String),
        status_update: {
          failed: true,
          ambiguous: true,
          terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
          internal_message_id: payload.message_id,
          message_id: payload.message_id,
          patch: {},
          event_id: expect.stringMatching(/^message_status_v1_/),
        },
      });
      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(4);
      const sends = consumer.streamProducerService.send.mock.calls;
      expect(
        new Set(
          sends.map(
            (call: unknown[]) => (call[1] as { event_id: string }).event_id
          )
        ).size
      ).toBe(1);
      expect(new Set(sends.map((call: unknown[]) => call[2])).size).toBe(1);
      expect(sends.slice(0, 3).map((call: unknown[]) => call[1])).toEqual(
        Array(3).fill(
          expect.objectContaining({
            runtime_generation: 11,
            connection_epoch: `connection-${provider}-11`,
          })
        )
      );
      expect(sends[3][1]).toEqual(
        expect.objectContaining({
          runtime_generation: 12,
          connection_epoch: `connection-${provider}-12`,
        })
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'replays only the succeeded update after a transient %s publication failure',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        message_id: 'message-replay-1',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: accountId },
        worker: { id: workerId },
        content: { type: 'text', message: 'hello' },
      };
      const update = {
        message: { key: { id: 'provider-message-1' } },
        data: payload,
      };
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: 'message-replay-1',
        key: 'message-send:idempotency:v3:test',
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
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      consumer.claimMessageSend = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce(duplicateClaim);
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload.message_id);
        await consumer.pushUpdate(update);
      });
      const commandEnvelope = () => ({
        commandId: 'command-replay-1',
        sourceTopic: 'UC_WORKER_COMMANDS_V1',
        partition: 0,
        offset: 12,
        kafkaKey: 'message-replay-1',
        payload,
        queueKey: consumer.resolveQueueContext(payload).queueKey,
        chatId: payload.chat_id,
        assertDispatchActive: jest.fn(() => undefined),
      });
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          consumer.processEnvelopeWithRetry(commandEnvelope())
        ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

        await expect(
          consumer.processEnvelopeWithRetry(commandEnvelope())
        ).resolves.toBeUndefined();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(consumer.processMessage).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(streamProducerService.send).toHaveBeenCalledTimes(2);
      expect(update).toMatchObject({
        worker_id: workerId,
        source_provider: provider,
        runtime_generation: 11,
        connection_epoch: `connection-${provider}-11`,
        event_id: expect.stringMatching(/^message_update_v1_/),
      });
      expect(streamProducerService.send.mock.calls[0][2]).toBe(
        `${accountId}:${workerId}:message-replay-1`
      );
      expect(streamProducerService.send.mock.calls[1][1]).toEqual(update);
      expect(streamProducerService.send.mock.calls[1][2]).toBe(
        `${accountId}:${workerId}:message-replay-1`
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'rebinds a succeeded %s recovery to the active runtime and requires Kafka ACK',
    async (_providerName, Consumer, provider) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const { scope } = configureConnectionScope(consumer, provider);
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const providerBoundary = jest.fn();
      consumer.messageSendIdempotencyService = {
        markProviderInvoked: providerBoundary,
      };
      consumer.streamProducerService = {
        send: jest
          .fn<Promise<void>, unknown[]>()
          .mockRejectedValueOnce(new Error('update Kafka unavailable'))
          .mockResolvedValueOnce(undefined),
      };
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
      };
      const assertDispatchActive = jest.fn(() => undefined);
      const expectedPayload = {
        message_id: 'internal-message-stale',
        chat_id: 'chat-stale',
        account: { id: accountId },
        worker: { id: scope.worker_id },
      };
      const staleUpdate = {
        event_id: '',
        worker_id: scope.worker_id,
        source_provider: provider,
        runtime_generation: scope.runtime_generation - 1,
        connection_epoch: 'older-connection-epoch',
        message: { key: { id: 'provider-message-stale' } },
        data: expectedPayload,
      };
      staleUpdate.event_id =
        buildMessageUpdateEventId(staleUpdate as never) ?? '';
      const stableEventId = staleUpdate.event_id;

      await expect(
        consumer.recoverSucceededUpdate(
          { update_message: staleUpdate },
          expectedPayload,
          assertDispatchActive
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      await expect(
        consumer.recoverSucceededUpdate(
          { update_message: staleUpdate },
          expectedPayload,
          assertDispatchActive
        )
      ).resolves.toBeUndefined();
      await expect(
        consumer.recoverSucceededUpdate(
          {
            update_message: {
              ...staleUpdate,
              event_id: 'forged-message-update-event',
            },
          },
          expectedPayload,
          assertDispatchActive
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(consumer.streamProducerService.send).toHaveBeenCalledTimes(2);
      for (const call of consumer.streamProducerService.send.mock.calls) {
        expect(call[0]).toBe('update.message');
        expect(call[1]).toMatchObject({
          event_id: stableEventId,
          worker_id: scope.worker_id,
          source_provider: provider,
          runtime_generation: scope.runtime_generation,
          connection_epoch: scope.connection_epoch,
          data: expectedPayload,
        });
        expect(call[2]).toBe(
          `${accountId}:${scope.worker_id}:internal-message-stale`
        );
        expect(call[4]).toBe(assertDispatchActive);
      }
      expect(providerBoundary).not.toHaveBeenCalled();
      expect(staleUpdate.runtime_generation).toBe(scope.runtime_generation - 1);
      expect(staleUpdate.connection_epoch).toBe('older-connection-epoch');
      expect(staleUpdate.event_id).toBe(stableEventId);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'redrives a %s send without terminal failure after the connection epoch changes before the provider starts',
    async (_providerName, Consumer, provider) => {
      const payload = {
        message_id: 'message-epoch-change',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
      };
      const update = {
        message: { key: { id: 'provider-message-epoch-change' } },
        data: payload,
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:epoch-change',
        owner: 'owner-1',
        result: null,
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      const { incoming, scope } = configureConnectionScope(consumer, provider);
      const nextScope = {
        ...scope,
        connection_epoch: `connection-${provider}-12`,
      };
      incoming.captureActiveConnectionScope
        .mockResolvedValueOnce(scope)
        .mockResolvedValueOnce(nextScope);
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markFailed: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      consumer.messageSendIdempotencyService = idempotency;
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
      };
      consumer.streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload.message_id);
        await consumer.pushUpdate(update);
      });

      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).not.toHaveBeenCalled();
      expect(idempotency.markFailed).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(consumer.streamProducerService.send).not.toHaveBeenCalled();
      expect((update as any).connection_epoch).toBeUndefined();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'reverses the %s provider-command CAS and never starts an auxiliary SDK mutation after assignment revocation',
    async (_providerName, Consumer, provider) => {
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        operationType: 'direct',
        operationId: 'worker-command-post-cas-revoked',
        key: 'message-send:idempotency:v3:worker-command-post-cas-revoked',
        owner: 'owner-1',
        result: null,
      };
      const revoked = new KafkaConsumerDispatchRevokedError();
      const assertDispatchActive = jest
        .fn<void, []>()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw revoked;
        });
      const providerMutation = jest.fn();
      const idempotency = {
        claimOperation: jest.fn(async () => claim),
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      const payload = {
        account_id:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        worker_id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
      };
      const action = async (
        beforeProviderInvoke: () => Promise<void>
      ): Promise<void> => {
        await beforeProviderInvoke();
        providerMutation();
      };

      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          {
            ...makeEnvelope(payload),
            assertDispatchActive,
          },
          action
        )
      ).rejects.toBe(revoked);

      expect(providerMutation).not.toHaveBeenCalled();
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim);
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'reverses a %s provider-invoked CAS and never starts the SDK when dispatch is revoked immediately after it',
    async (_providerName, Consumer) => {
      const payload = {
        message_id: 'message-dispatch-fence-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:dispatch-fence',
        owner: 'owner-1',
        result: null,
      };
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const assertDispatchActive = jest
        .fn<void, []>()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw dispatchRevoked;
        });
      const providerCall = jest.fn();
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.RESERVATION_LEASE_MS = 30_000;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(
        consumer,
        Consumer === MessageSendConsume ? 'baileys' : 'wwebjs'
      );
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload);
        providerCall();
      });

      await expect(
        consumer.processPayload(payload, {
          ...makeEnvelope(payload),
          assertDispatchActive,
        })
      ).rejects.toBe(dispatchRevoked);

      expect(assertDispatchActive).toHaveBeenCalledTimes(3);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          schema_version: 'message_send_ambiguous_terminal_v1',
        }),
        expect.any(Number)
      );
      expect(
        idempotency.revertProviderInvocationBeforeStart
      ).toHaveBeenCalledWith(claim, expect.any(Number));
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).toHaveBeenCalledWith(claim);
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'persists a %s terminal failure when no message handler can run',
    async (_providerName, Consumer) => {
      const payload = {
        message_id: 'message-preflight-1',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
        content: { type: EMessageType.image, image: {} },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'message-preflight-1',
        key: 'message-send:idempotency:v3:preflight',
        owner: 'owner-1',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        markFailed: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.lastMessageTypeByChatId = new Map();
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(
        consumer,
        Consumer === MessageSendConsume ? 'baileys' : 'wwebjs'
      );
      consumer.claimMessageSend = jest.fn(async () => claim);

      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).rejects.toThrow('message_send_handler_unavailable');

      expect(idempotency.markProviderInvoked).not.toHaveBeenCalled();
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(idempotency.markFailed).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({
          message: 'message_send_handler_unavailable',
        }),
        expect.objectContaining({
          schema_version: 'message_send_terminal_failure_recovery_v1',
        })
      );
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'does not reserve or invoke %s when no active connection scope exists',
    async (_providerName, Consumer, provider) => {
      const payload = {
        message_id: 'message-without-scope',
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: 'account-1' },
        worker: { id: 'worker-1' },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:no-scope',
        owner: 'owner-1',
        result: null,
      };
      const releaseReservation = jest.fn(async () => 'transitioned');
      const markFailed = jest.fn(async () => 'transitioned');
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      const { incoming } = configureConnectionScope(consumer, provider);
      (
        incoming.captureActiveConnectionScope as unknown as jest.Mock<
          Promise<null>,
          []
        >
      ).mockResolvedValue(null);
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.messageSendIdempotencyService = {
        releaseReservation,
        markFailed,
      };
      consumer.processMessage = jest.fn(async () => undefined);

      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(consumer.claimMessageSend).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
      expect(releaseReservation).not.toHaveBeenCalled();
      expect(consumer.processMessage).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'recovers one %s send after offline capture becomes online without failed status or stale-scope reuse',
    async (_providerName, Consumer, provider) => {
      const payload = {
        message_id: `message-offline-online-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
        },
        account: {
          id: provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        },
        worker: {
          id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
        },
        content: { type: EMessageType.text, message: 'hello' },
      };
      const envelope = makeEnvelope(payload) as ReturnType<
        typeof makeEnvelope
      > & {
        connectionScopeCaptured?: boolean;
        connectionScope?: unknown;
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: payload.account.id,
        operationType: 'direct',
        operationId: payload.message_id,
        key: `message-send:idempotency:v3:offline-online-${provider}`,
        owner: 'owner-offline-online',
        result: null,
      };
      const idempotency = {
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markFailed: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.activeSendDispatchGuards = new Map();
      consumer.activeSendConnectionScopes = new Map();
      consumer.activeSendPreProviderDeadlines = new Map();
      consumer.activeSendProviderStartedResolvers = new Map();
      consumer.messageSendIdempotencyService = idempotency;
      const { incoming, scope } = configureConnectionScope(consumer, provider);
      (
        incoming.captureActiveConnectionScope as unknown as jest.Mock<
          Promise<typeof scope | null>,
          []
        >
      )
        .mockResolvedValueOnce(null)
        .mockResolvedValue(scope);
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.kafkaServiceQueueService = {
        updateMessage: jest.fn(() => 'update.message'),
        updateMessageStatus: jest.fn(() => 'update.message.status'),
      };
      consumer.streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload);
        providerCall();
        await consumer.pushUpdate({
          message: {
            key: { id: `provider-${provider}` },
            message: { conversation: 'hello' },
          },
          data: payload,
        });
      });

      await expect(
        consumer.processPayload(payload, envelope)
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
      expect(envelope.connectionScopeCaptured).toBe(false);
      expect(consumer.claimMessageSend).not.toHaveBeenCalled();

      await expect(
        consumer.processPayload(payload, envelope)
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
      expect(idempotency.markFailed).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
      expect(
        consumer.kafkaServiceQueueService.updateMessageStatus
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume],
    ['WWebJS', MessageSendWwebjsConsume],
  ])(
    'treats a missing %s provider-command account as permanently invalid with provider parity',
    async (_providerName, Consumer) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const claimOperation = jest.fn();
      consumer.messageSendIdempotencyService = { claimOperation };

      await expect(
        consumer.processProviderCommandWithIdempotency(
          { account_id: '', worker_id: 'worker' },
          makeEnvelope(),
          jest.fn()
        )
      ).rejects.toMatchObject({
        message: 'message_send_idempotency_account_missing',
        nonRetryable: true,
      });

      expect(claimOperation).not.toHaveBeenCalled();
    }
  );

  it('shares provider-command identity across Baileys and WWebJS without collapsing distinct Kafka actions', async () => {
    const acquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'worker-command',
      key: 'message-send:idempotency:v3:worker-command',
      owner: 'owner-1',
      result: null,
    };
    const claimOperation = jest
      .fn()
      .mockResolvedValueOnce(acquiredClaim)
      .mockResolvedValueOnce({
        ...acquiredClaim,
        status: 'duplicate',
        state: 'succeeded',
        owner: null,
      })
      .mockResolvedValueOnce({
        ...acquiredClaim,
        owner: 'owner-2',
      });
    const idempotency = {
      claimOperation,
      markProviderInvoked: jest.fn(async () => 'transitioned'),
      markSucceeded: jest.fn(async () => 'transitioned'),
      markAmbiguous: jest.fn(async () => 'transitioned'),
      releaseReservation: jest.fn(async () => 'transitioned'),
    };
    const baileys = Object.create(MessageSendConsume.prototype) as any;
    const wwebjs = Object.create(MessageSendWwebjsConsume.prototype) as any;
    baileys.messageSendIdempotencyService = idempotency;
    wwebjs.messageSendIdempotencyService = idempotency;
    configureConnectionScope(baileys, 'baileys');
    configureConnectionScope(wwebjs, 'wwebjs');
    const firstAction = jest.fn(async () => undefined);
    const duplicateAction = jest.fn(async () => undefined);
    const distinctAction = jest.fn(async () => undefined);
    const baileysPayload = {
      account_id: 'account-baileys',
      worker_id: 'worker-baileys',
    };
    const wwebjsPayload = {
      account_id: 'account-wwebjs',
      worker_id: 'worker-wwebjs',
    };
    const firstEnvelope = makeEnvelope(baileysPayload);

    await baileys.processProviderCommandWithIdempotency(
      baileysPayload,
      firstEnvelope,
      firstAction
    );
    await wwebjs.processProviderCommandWithIdempotency(
      wwebjsPayload,
      makeEnvelope(wwebjsPayload),
      duplicateAction
    );
    await wwebjs.processProviderCommandWithIdempotency(
      wwebjsPayload,
      { ...makeEnvelope(wwebjsPayload), offset: firstEnvelope.offset + 1 },
      distinctAction
    );

    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(duplicateAction).not.toHaveBeenCalled();
    expect(distinctAction).toHaveBeenCalledTimes(1);
    expect(claimOperation.mock.calls[0][0].operationId).toBe(
      claimOperation.mock.calls[1][0].operationId
    );
    expect(claimOperation.mock.calls[2][0].operationId).not.toBe(
      claimOperation.mock.calls[0][0].operationId
    );
  });

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'post-CAS fences the first %s provider command mutation without fencing subsequent mutations',
    async (_providerName, Consumer, provider) => {
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'worker-command',
        key: 'message-send:idempotency:v3:worker-command-multiple',
        owner: 'owner-1',
        result: null,
      };
      const order: string[] = [];
      const idempotency = {
        claimOperation: jest.fn(async () => acquiredClaim),
        markProviderInvoked: jest.fn(async () => {
          order.push('provider_invoked');
          return 'transitioned';
        }),
        revertProviderInvocationBeforeStart: jest.fn(
          async () => 'transitioned'
        ),
        markSucceeded: jest.fn(async () => {
          order.push('succeeded');
          return 'transitioned';
        }),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      const payload = {
        account_id:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        worker_id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
      };
      const dispatchRevoked = new KafkaConsumerDispatchRevokedError();
      const assertDispatchActive = jest.fn(() => {
        if (assertDispatchActive.mock.calls.length > 4) {
          throw dispatchRevoked;
        }
      });
      const envelope = {
        ...makeEnvelope(payload),
        assertDispatchActive,
      };
      const action = jest.fn(
        async (beforeProviderInvoke: () => Promise<void>) => {
          await beforeProviderInvoke();
          order.push('first_provider_mutation');
          await beforeProviderInvoke();
          order.push('second_provider_mutation');
          return async () => {
            order.push('after_durable_success');
          };
        }
      );

      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();

      expect(assertDispatchActive).toHaveBeenCalledTimes(3);
      expect(order).toEqual([
        'provider_invoked',
        'first_provider_mutation',
        'second_provider_mutation',
        'succeeded',
        'after_durable_success',
      ]);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'rejects malformed nested %s direct payloads before any runtime, Redis, or provider boundary',
    (_providerName, Consumer, _provider) => {
      const consumer = Object.create(Consumer.prototype) as any;
      const base = {
        message_id: 'message-runtime-schema',
        chat_id: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
          is_view_once: false,
        },
        account: { id: 'account-runtime-schema' },
        worker: { id: 'worker-runtime-schema' },
        content: {
          type: EMessageType.text,
          message: 'hello',
        },
      };
      const malformed = [
        {
          ...base,
          message_key: { ...base.message_key, remote_jid: 123 },
        },
        {
          ...base,
          content: { type: 'unknown-message-type', message: 'hello' },
        },
        {
          ...base,
          content: {
            type: EMessageType.image,
            image: { url: 123 },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.contacts,
            contacts: { length: 1 },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.react,
            reactions: { emoji: '👍' },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.text,
            message: 'quoted',
            quoted: {
              type: EMessageType.contacts,
              key: {
                id: 'quoted-message',
                remote_jid: '5511999999999@s.whatsapp.net',
                is_view_once: false,
              },
              contacts: { length: 1 },
            },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.text,
            message: 'version poison',
            version: { date: '2026-07-30', message: 'old' },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.text,
            message: 'forward poison',
            forward: {
              source_message_id: 123,
              source_chat_id: 'source-chat',
              source_type: EMessageType.text,
            },
          },
        },
        {
          ...base,
          content: {
            type: EMessageType.official_interactive,
            official: {
              provider: 'meta_whatsapp',
              type: 'interactive',
              display: {
                kind: 'cta_url',
                actions: [{ title: 123 }],
              },
            },
          },
        },
      ];

      for (const payload of malformed) {
        expect(consumer.parseRawMessage(JSON.stringify(payload))).toBeNull();
      }

      const zeroLocation = {
        ...base,
        content: {
          type: EMessageType.location,
          location: {
            latitude: 0,
            longitude: 0,
            name: 'Null Island',
          },
        },
      };
      expect(consumer.parseRawMessage(JSON.stringify(zeroLocation))).toEqual(
        zeroLocation
      );
      const infiniteCoordinate = JSON.stringify(zeroLocation).replace(
        '"latitude":0',
        '"latitude":1e999'
      );
      expect(consumer.parseRawMessage(infiniteCoordinate)).toBeNull();
      expect(consumer.parseRawMessage(JSON.stringify(base))).toEqual(base);
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps %s direct and profile commands uncommitted when runtime-scope capture fails before Redis',
    async (_providerName, Consumer, provider) => {
      const captureFailure = new Error('runtime-fence Redis unavailable');
      const claimOperation = jest.fn();
      const profileMutation = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = { claimOperation };
      consumer[
        provider === 'baileys'
          ? 'baileysIncomingMessageService'
          : 'wwebjsIncomingMessageService'
      ] = {
        captureActiveConnectionScope: jest.fn(async () => {
          throw captureFailure;
        }),
      };
      consumer[
        provider === 'baileys'
          ? 'baileysProfileService'
          : 'wwebjsProfileService'
      ] = {
        updateProfileName: profileMutation,
      };
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const directPayload = {
        message_id: `message-capture-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: { id: accountId },
        worker: { id: workerId },
      };
      const profilePayload = {
        account_id: accountId,
        worker_id: workerId,
        name: 'Underchat',
      };

      await expect(
        consumer.processPayload(directPayload, makeEnvelope(directPayload))
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: captureFailure,
      });
      await expect(
        consumer.processPayload(profilePayload, makeEnvelope(profilePayload))
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: captureFailure,
      });

      expect(claimOperation).not.toHaveBeenCalled();
      expect(profileMutation).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'replays a durable %s profile-status external id after Kafka failure without invoking the provider twice',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        account_id: accountId,
        worker_id: workerId,
        worker_profile_status_id: `profile-status-recovery-${provider}`,
        worker_profile_status_type_id: EWorkerProfileStatusType.text,
        value: 'recovery status',
        is_permanent: false,
      };
      const acquired = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: 'worker-command-profile-status-recovery',
        key: 'message-send:idempotency:v3:profile-status-recovery',
        owner: 'profile-status-recovery-owner',
        result: null,
      };
      let storedRecovery: unknown = null;
      const claimOperation = jest
        .fn()
        .mockResolvedValueOnce(acquired)
        .mockImplementationOnce(async () => ({
          ...acquired,
          status: 'duplicate',
          state: 'succeeded',
          owner: null,
          result: storedRecovery,
        }));
      const markSucceeded = jest.fn(
        async (_claim: unknown, recovery: unknown) => {
          storedRecovery = recovery;
          return 'transitioned';
        }
      );
      const idempotency = {
        claimOperation,
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded,
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const auxiliaryUnavailable = new Error(
        'profile external-id Kafka unavailable'
      );
      const streamProducerService = {
        send: jest
          .fn()
          .mockRejectedValueOnce(auxiliaryUnavailable)
          .mockResolvedValueOnce(undefined),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      consumer.streamProducerService = streamProducerService;
      consumer.kafkaServiceQueueService = {
        updateProfileStatusExternalId: jest.fn(
          () => 'update.profile.status.external-id'
        ),
      };
      configureConnectionScope(consumer, provider);
      const action = jest.fn(
        async (beforeProviderInvoke: () => Promise<void>) => {
          await beforeProviderInvoke();
          providerCall();
          return provider === 'baileys'
            ? consumer.handleStatusResult(
                { key: { id: 'status-external-id-recovery' } },
                payload.worker_profile_status_id,
                'status failed'
              )
            : consumer.buildStatusExternalIdPublisher(
                { key: { id: 'status-external-id-recovery' } },
                payload.worker_profile_status_id
              );
        }
      );
      const envelope = makeEnvelope(payload);

      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: auxiliaryUnavailable,
      });
      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();

      expect(action).toHaveBeenCalledTimes(1);
      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(markSucceeded).toHaveBeenCalledWith(
        acquired,
        expect.objectContaining({
          schema_version: 'profile_status_external_id_recovery_v1',
          external_id: 'status-external-id-recovery',
          worker_profile_status_id: payload.worker_profile_status_id,
        })
      );
      expect(streamProducerService.send).toHaveBeenCalledTimes(2);
      expect(streamProducerService.send.mock.calls[1]?.[1]).toEqual(
        streamProducerService.send.mock.calls[0]?.[1]
      );
      expect(streamProducerService.send.mock.calls[1]?.[2]).toBe(
        `${accountId}:${workerId}:${payload.worker_profile_status_id}`
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps a %s profile-status acknowledgement without external id durably ambiguous and never retries the provider',
    async (_providerName, Consumer, provider) => {
      const accountId =
        provider === 'baileys' ? 'account-baileys' : 'account-wwebjs';
      const workerId =
        provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs';
      const payload = {
        account_id: accountId,
        worker_id: workerId,
        worker_profile_status_id: `profile-status-missing-id-${provider}`,
        worker_profile_status_type_id: EWorkerProfileStatusType.text,
        value: 'status without external id',
        is_permanent: false,
      };
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId,
        operationType: 'direct',
        operationId: 'worker-command-profile-status-missing-id',
        key: 'message-send:idempotency:v3:profile-status-missing-id',
        owner: 'profile-status-missing-id-owner',
        result: null,
      };
      const claimOperation = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce({
          ...acquiredClaim,
          status: 'duplicate',
          state: 'ambiguous',
          owner: null,
        });
      const idempotency = {
        claimOperation,
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const providerCall = jest.fn();
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      const action = jest.fn(
        async (beforeProviderInvoke: () => Promise<void>) => {
          await beforeProviderInvoke();
          providerCall();
          return provider === 'baileys'
            ? consumer.handleStatusResult(
                { key: {} },
                payload.worker_profile_status_id,
                'status failed'
              )
            : consumer.buildStatusExternalIdPublisher(
                { key: {} },
                payload.worker_profile_status_id
              );
        }
      );
      const envelope = makeEnvelope(payload);

      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();
      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();

      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        acquiredClaim,
        expect.objectContaining({
          message: 'profile_status_external_id_missing_after_provider_send',
        }),
        undefined
      );
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'terminally consumes an ambiguous %s provider command without retrying it',
    async (_providerName, Consumer, provider) => {
      const acquiredClaim = {
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'worker-command',
        key: 'message-send:idempotency:v3:worker-command-ambiguous',
        owner: 'owner-1',
        result: null,
      };
      const claimOperation = jest
        .fn()
        .mockResolvedValueOnce(acquiredClaim)
        .mockResolvedValueOnce({
          ...acquiredClaim,
          status: 'duplicate',
          state: 'ambiguous',
          owner: null,
        });
      const idempotency = {
        claimOperation,
        markProviderInvoked: jest.fn(async () => 'transitioned'),
        markSucceeded: jest.fn(async () => 'transitioned'),
        markAmbiguous: jest.fn(async () => 'transitioned'),
        releaseReservation: jest.fn(async () => 'transitioned'),
      };
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.messageSendIdempotencyService = idempotency;
      configureConnectionScope(consumer, provider);
      const providerError = new Error('provider command acknowledgement lost');
      const action = jest.fn(
        async (beforeProviderInvoke: () => Promise<void>) => {
          await beforeProviderInvoke();
          throw providerError;
        }
      );
      const payload = {
        account_id:
          provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        worker_id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
      };
      const envelope = makeEnvelope(payload);

      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();
      await expect(
        consumer.processProviderCommandWithIdempotency(
          payload,
          envelope,
          action
        )
      ).resolves.toBeUndefined();

      expect(action).toHaveBeenCalledTimes(1);
      expect(idempotency.markProviderInvoked).toHaveBeenCalledTimes(1);
      expect(idempotency.markAmbiguous).toHaveBeenCalledWith(
        acquiredClaim,
        providerError,
        undefined
      );
      expect(idempotency.markSucceeded).not.toHaveBeenCalled();
      expect(idempotency.releaseReservation).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', MessageSendConsume, 'baileys' as const],
    ['WWebJS', MessageSendWwebjsConsume, 'wwebjs' as const],
  ])(
    'keeps a %s transition fail-closed when provider-invoked CAS applies but its response is lost',
    async (_providerName, Consumer, provider) => {
      const payload = {
        message_id: `message-cas-response-lost-${provider}`,
        chat_id: '5511999999999@s.whatsapp.net',
        account: {
          id: provider === 'baileys' ? 'account-baileys' : 'account-wwebjs',
        },
        worker: {
          id: provider === 'baileys' ? 'worker-baileys' : 'worker-wwebjs',
        },
      };
      const claim = {
        status: 'acquired',
        state: 'reserved',
        accountId: payload.account.id,
        operationType: 'direct',
        operationId: payload.message_id,
        key: 'message-send:idempotency:v3:test',
        owner: 'owner-1',
        result: null,
      };
      let durableState = 'reserved';
      const releaseReservation = jest.fn(async () => 'transitioned');
      const markFailed = jest.fn(async () => 'transitioned');
      const consumer = Object.create(Consumer.prototype) as any;
      consumer.activeSendClaims = new Map();
      consumer.providerInvokedSendClaims = new Set();
      consumer.claimMessageSend = jest.fn(async () => claim);
      consumer.messageSendIdempotencyService = {
        markProviderInvoked: jest.fn(async () => {
          durableState = 'provider_invoked';
          throw new Error('redis response lost after CAS');
        }),
        releaseReservation,
        markFailed,
      };
      configureConnectionScope(consumer, provider);
      consumer.processMessage = jest.fn(async () => {
        await consumer.markActiveProviderInvoked(payload.message_id);
      });

      await expect(
        consumer.processPayload(payload, makeEnvelope(payload))
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(durableState).toBe('provider_invoked');
      expect(markFailed).not.toHaveBeenCalled();
      expect(releaseReservation).not.toHaveBeenCalled();
      expect(consumer.processMessage).toHaveBeenCalledTimes(1);
    }
  );

  it('does not execute the Baileys fallback after a native forward crosses the provider boundary', async () => {
    const consumer = Object.create(MessageSendConsume.prototype) as any;
    const message = {
      message_id: 'forward-message-1',
      content: {
        type: EMessageType.text,
        message: 'fallback must not be sent',
        forward: {
          source_message_id: 'source-message-1',
        },
      },
    };
    const fallback = jest.fn(async () => undefined);
    consumer.providerInvokedSendClaims = new Set<string>();
    consumer.hydrateForwardSourceKey = jest.fn(async () => undefined);
    consumer.tryNativeForward = jest.fn(async () => {
      consumer.providerInvokedSendClaims.add(message.message_id);
      throw new Error('native forward acknowledgement timeout');
    });
    consumer.selectMessageHandler = jest.fn(() => fallback);
    consumer.logForwardResult = jest.fn();

    await expect(
      consumer.processForwardMessage(
        EMessageType.text,
        '5511999999999@s.whatsapp.net',
        'chat-1',
        message,
        undefined,
        false
      )
    ).rejects.toThrow('native forward acknowledgement timeout');

    expect(fallback).not.toHaveBeenCalled();
    expect(consumer.selectMessageHandler).not.toHaveBeenCalled();
  });
});
