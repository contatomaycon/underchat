import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { EMessageType } from '@core/common/enums/EMessageType';

const previousHistoryReconciliationEnabled =
  process.env.HISTORY_RECONCILIATION_ENABLED;
process.env.HISTORY_RECONCILIATION_ENABLED = 'true';
afterAll(() => {
  if (previousHistoryReconciliationEnabled === undefined) {
    delete process.env.HISTORY_RECONCILIATION_ENABLED;
  } else {
    process.env.HISTORY_RECONCILIATION_ENABLED =
      previousHistoryReconciliationEnabled;
  }
});

function runtimeEffectLease(fence: unknown = null) {
  return {
    fence,
    assertOwned: jest.fn(),
    assertOwnedRemote: jest.fn(async () => undefined),
    release: jest.fn(async () => true),
  };
}

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.replace(/@c\.us$/, '@s.whatsapp.net'),
  proto: {
    Message: {
      decode: jest.fn(),
      encode: jest.fn(() => ({ finish: () => Buffer.from('') })),
      ProtocolMessage: {
        Type: {
          REVOKE: 0,
          MESSAGE_EDIT: 1,
          EPHEMERAL_SETTING: 2,
          EPHEMERAL_SYNC_RESPONSE: 3,
        },
      },
      SecretEncryptedMessage: {
        SecretEncType: {
          UNKNOWN: 0,
          EVENT_EDIT: 1,
          MESSAGE_EDIT: 2,
        },
      },
    },
    WebMessageInfo: {
      Status: {},
      StubType: {
        CIPHERTEXT: 1,
      },
    },
  },
  isJidBroadcast: (jid?: string) => jid?.endsWith('@broadcast') ?? false,
  isJidGroup: (jid?: string) => jid?.endsWith('@g.us') ?? false,
  isJidNewsletter: (jid?: string) => jid?.endsWith('@newsletter') ?? false,
  isJidStatusBroadcast: (jid?: string) =>
    jid === 'status@broadcast' || jid?.endsWith('@status') === true,
  isLidUser: (jid?: string) => jid?.endsWith('@lid') ?? false,
  isPnUser: (jid?: string) => jid?.endsWith('@s.whatsapp.net') ?? false,
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-1',
    baileysWorkerId: 'worker-1',
    runtimeGeneration: 7,
  },
  generalEnvironment: {
    automationSendDedupeTtlSeconds: 60,
  },
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

jest.mock('@core/services/baileys/methods/upsertMediaEnricher.service', () => ({
  BaileysUpsertMediaEnricher: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock(
  '@core/services/baileys/methods/deliveryConfirmation.service',
  () => ({
    BaileysDeliveryConfirmationService: class {},
  })
);

import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { mapIncomingToType } from '@core/common/functions/mapIncomingToType';
import type { IInboundMessageSpoolPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function serializedLongTimestamp(timestampMs: number) {
  const seconds = Math.floor(timestampMs / 1000);
  return {
    low: seconds | 0,
    high: Math.floor(seconds / 0x100000000),
    unsigned: true,
  };
}

function spoolPayload(
  overrides: Partial<IInboundMessageSpoolPayload> = {}
): IInboundMessageSpoolPayload {
  return {
    provider: 'baileys',
    source_provider: 'baileys',
    account_id: 'account-1',
    worker_id: 'worker-1',
    runtime_generation: '6',
    connection_epoch: 'previous-epoch',
    event_source: 'incoming_upsert',
    dedupe_key: 'inbound-event-1',
    kafka_topic: 'upsert-message',
    kafka_key: 'account-1:worker-1:chat-1',
    upsert: {
      event_id: 'inbound-event-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      source_provider: 'baileys',
      runtime_generation: '6',
      connection_epoch: 'previous-epoch',
      type: EMessageType.text,
      message: {
        key: {
          id: 'message-1',
          remoteJid: '5511999999999@s.whatsapp.net',
        },
        message: { conversation: 'hello' },
        messageTimestamp: serializedLongTimestamp(Date.now()) as never,
      },
      has_quoted: false,
    },
    received_at: new Date().toISOString(),
    attempts: 0,
    ...overrides,
  };
}

describe('BaileysIncomingMessageService', () => {
  it('acquires worker effects only for its own active connection epoch', async () => {
    const acquireEffectLease = jest.fn(async (input) =>
      runtimeEffectLease(input)
    );
    const service = Object.create(
      BaileysIncomingMessageService.prototype
    ) as any;
    service.whatsappRuntimeFenceService = { acquireEffectLease };
    service.activeConnectionScope = {
      runtimeGeneration: 8,
      connectionEpoch: 'baileys-local-epoch',
      activation: Promise.resolve(true),
    };

    await expect(
      service.acquireActiveRuntimeEffectLease()
    ).resolves.not.toBeNull();
    expect(acquireEffectLease).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_generation: 8,
        connection_epoch: 'baileys-local-epoch',
        source_provider: 'baileys',
      })
    );
  });

  const createdServices: BaileysIncomingMessageService[] = [];

  const makeService = () => {
    const redisStore = new Map<string, string>();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const balanceWorkerStatusGrpcClientService = {
      activateWhatsappRuntimeFence: jest.fn(async () => ({
        connection_sequence: 1,
        already_active: false,
      })),
      resolveIncomingCallAction: jest.fn(async () => ({
        reject_call: false,
        show_message_on_call: false,
        show_message_text: '',
      })),
    };
    const messageSendIdempotencyService = {
      claimOperation: jest.fn(
        async (input: {
          accountId: string;
          operationType: 'direct';
          operationId: string;
        }): Promise<unknown> => ({
          status: 'acquired',
          state: 'reserved',
          accountId: input.accountId,
          operationType: input.operationType,
          operationId: input.operationId,
          key: `claim:${input.operationId}`,
          owner: 'owner-1',
          result: null,
        })
      ),
      markProviderInvoked: jest.fn(async () => 'transitioned'),
      revertProviderInvocationBeforeStart: jest.fn(async () => 'transitioned'),
      markSucceeded: jest.fn(async () => 'transitioned'),
      markAmbiguous: jest.fn(async () => 'transitioned'),
      releaseReservation: jest.fn(async () => 'transitioned'),
    };
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    const whatsappRuntimeFenceService = {
      beginActivation: jest.fn(async () => ({
        status: 'acquired',
        activation_order: 1,
        activated_at: Date.now(),
        connection_sequence: 0,
      })),
      finalizeActivation: jest.fn(async () => true),
      deactivate: jest.fn(async () => true),
      isCurrent: jest.fn(async () => true),
      acquireEffectLease: jest.fn(async (input) => runtimeEffectLease(input)),
      acquireActiveEffectLease: jest.fn(async () => runtimeEffectLease()),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const deliveryConfirmation = {
      waitForOutcome: jest.fn(async () => 'sent'),
    };
    const service = new BaileysIncomingMessageService(
      streamProducerService as never,
      {
        upsertMessage: jest.fn(() => 'upsert-message'),
        upsertMessageHistory: jest.fn(() => 'upsert-message-history'),
        updateMessageStatus: jest.fn(() => 'update-message-status'),
      } as never,
      centrifugoService as never,
      redis as never,
      { enrich: jest.fn(async () => undefined) } as never,
      balanceWorkerStatusGrpcClientService as never,
      deliveryConfirmation as never,
      messageSendIdempotencyService as never,
      undefined,
      undefined,
      whatsappRuntimeFenceService as never
    );
    (
      service as unknown as { activeConnectionScope: unknown }
    ).activeConnectionScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'test-epoch',
      activationOrder: 1,
      connectionSequence: 1,
      activatedAt: 1000,
      activation: Promise.resolve(true),
    };
    createdServices.push(service);

    return {
      service,
      redis,
      redisStore,
      streamProducerService,
      balanceWorkerStatusGrpcClientService,
      messageSendIdempotencyService,
      whatsappRuntimeFenceService,
      centrifugoService,
      deliveryConfirmation,
    };
  };

  afterEach(async () => {
    await Promise.all(
      createdServices.splice(0).map((service) => service.destroy())
    );
    jest.restoreAllMocks();
  });

  it('redrives a superseded serialized Baileys payload outside the history window', async () => {
    const { service, streamProducerService, whatsappRuntimeFenceService } =
      makeService();
    const stale = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: {
          ...spoolPayload().upsert.message,
          messageTimestamp: serializedLongTimestamp(
            Date.now() - 7 * 60 * 60 * 1000
          ) as never,
        },
      },
    });

    await expect(
      (service as any).publishSpoolPayload(stale)
    ).resolves.toBeUndefined();

    expect(whatsappRuntimeFenceService.isCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_generation: 7,
        connection_epoch: 'test-epoch',
        source_provider: 'baileys',
      })
    );
    expect(whatsappRuntimeFenceService.acquireEffectLease).toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      stale.kafka_topic,
      expect.objectContaining({
        event_id: stale.upsert.event_id,
        runtime_generation: '7',
        connection_epoch: 'test-epoch',
        from_history_sync: true,
      }),
      stale.kafka_key
    );
  });

  it('rehomes a recent superseded serialized Baileys payload through the active runtime', async () => {
    const { service, streamProducerService } = makeService();
    const payload = spoolPayload();

    await expect(
      (service as any).publishSpoolPayload(payload)
    ).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      payload.kafka_topic,
      expect.objectContaining({
        runtime_generation: '7',
        connection_epoch: 'test-epoch',
        from_history_sync: true,
      }),
      payload.kafka_key
    );
  });

  it('preserves at-least-once delivery when a persisted timestamp is invalid', async () => {
    const { service, streamProducerService } = makeService();
    const invalid = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: {
          ...spoolPayload().upsert.message,
          messageTimestamp: { low: 'invalid' } as never,
        },
      },
    });

    await expect(
      (service as any).publishSpoolPayload(invalid)
    ).resolves.toBeUndefined();
    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
  });

  it('preserves at-least-once delivery without a persisted message envelope', async () => {
    const { service, streamProducerService } = makeService();
    const missingMessage = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: null as never,
      },
    });

    await expect(
      (service as any).publishSpoolPayload(missingMessage)
    ).resolves.toBeUndefined();
    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a stale payload durable when the active scope changes while its fence is being confirmed', async () => {
    const { service, streamProducerService, whatsappRuntimeFenceService } =
      makeService();
    const fenceConfirmation = deferredBoolean();
    whatsappRuntimeFenceService.isCurrent.mockImplementationOnce(
      () => fenceConfirmation.promise
    );
    const stale = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: {
          ...spoolPayload().upsert.message,
          messageTimestamp: serializedLongTimestamp(
            Date.now() - 7 * 60 * 60 * 1000
          ) as never,
        },
      },
    });

    const rejection = (service as any).publishSpoolPayload(stale);
    await new Promise<void>((resolve) => setImmediate(resolve));
    (service as any).activeConnectionScope = {
      runtimeGeneration: 8,
      connectionEpoch: 'replacement-epoch',
      activationOrder: 2,
      connectionSequence: 2,
      activatedAt: Date.now(),
      activation: Promise.resolve(true),
    };
    fenceConfirmation.resolve(true);

    await expect(rejection).rejects.toThrow(
      'baileys_inbound_spool_runtime_lease_revoked'
    );
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('activates the runtime connection epoch only after the socket is open', async () => {
    const {
      service,
      whatsappRuntimeFenceService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();
    const socket = {
      ev: new EventEmitter(),
    };

    service.bindTo(socket as never);

    expect(whatsappRuntimeFenceService.beginActivation).not.toHaveBeenCalled();
    await expect(service.markConnectionReady(socket as never)).resolves.toBe(
      true
    );
    expect(
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence
    ).toHaveBeenCalledTimes(1);
    expect(whatsappRuntimeFenceService.beginActivation).toHaveBeenCalledTimes(
      1
    );
    expect(
      whatsappRuntimeFenceService.finalizeActivation
    ).toHaveBeenCalledTimes(1);
    expect(
      whatsappRuntimeFenceService.beginActivation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mock
        .invocationCallOrder[0]
    );
    expect(
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      whatsappRuntimeFenceService.finalizeActivation.mock.invocationCallOrder[0]
    );
  });

  it('reuses the manager-authorized epoch and attempt for socket activation', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    const socket = { ev: new EventEmitter() };

    service.bindTo(socket as never, {
      connection_epoch: '11111111-1111-4111-8111-111111111111',
      connection_attempt_id: '22222222-2222-4222-8222-222222222222',
    });
    await expect(service.markConnectionReady(socket as never)).resolves.toBe(
      true
    );

    expect(
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_epoch: '11111111-1111-4111-8111-111111111111',
        connection_attempt_id: '22222222-2222-4222-8222-222222222222',
      })
    );
  });

  it('keeps history reconciliation disabled when explicitly disabled', () => {
    process.env.HISTORY_RECONCILIATION_ENABLED = 'false';
    try {
      const { service } = makeService();
      const sut = service as unknown as {
        selectLatestHistoryMessages: (messages: unknown[]) => unknown[];
      };

      expect(
        sut.selectLatestHistoryMessages([
          {
            key: {
              id: 'history-disabled',
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: false,
            },
            messageTimestamp: Math.floor(Date.now() / 1000),
            message: { conversation: 'must not reconcile' },
          },
        ])
      ).toHaveLength(0);
    } finally {
      process.env.HISTORY_RECONCILIATION_ENABLED = 'true';
    }
  });

  it('maps legacy button messages as text instead of unsupported fallback', () => {
    expect(
      mapIncomingToType({
        key: {
          id: 'button-message-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
        message: {
          buttonsMessage: {
            contentText: 'Escolha uma opção',
            buttons: [
              {
                buttonId: '1',
                buttonText: { displayText: 'Atendimento' },
                type: 1,
              },
            ],
          },
        },
      } as never)
    ).toBe(EMessageType.text);
  });

  it('maps native flow CTA URL interactive messages as text', () => {
    expect(
      mapIncomingToType({
        key: {
          id: 'cta-url-message-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
        message: {
          interactiveMessage: {
            body: { text: 'Clique no link para abrir' },
            nativeFlowMessage: {
              buttons: [
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: 'Underchat',
                    url: 'https://underchat.com.br/',
                  }),
                },
              ],
            },
          },
        },
      } as never)
    ).toBe(EMessageType.text);
  });

  it('publishes message edit updates from Baileys messages.update as edit_text upserts', async () => {
    const { service, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      handleMessagesUpdate: (events: unknown[]) => Promise<void>;
    };
    sut.currentSocket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async () => undefined),
    };

    await sut.handleMessagesUpdate([
      {
        key: {
          id: 'message-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        update: {
          message: {
            protocolMessage: {
              type: 1,
              editedMessage: {
                conversation: 'Oi editado',
                extendedTextMessage: { text: 'Oi editado' },
              },
            },
          },
        },
      },
    ]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        type: EMessageType.edit_text,
        message: expect.objectContaining({
          key: expect.objectContaining({
            id: 'message-1',
            remoteJid: '5511999999999@s.whatsapp.net',
          }),
          message: expect.objectContaining({
            protocolMessage: expect.objectContaining({
              key: expect.objectContaining({
                id: 'message-1',
                remoteJid: '5511999999999@s.whatsapp.net',
              }),
              editedMessage: expect.objectContaining({
                conversation: 'Oi editado',
              }),
            }),
          }),
        }),
      }),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
  });

  it('does not invent edit idempotency from Baileys second-resolution timestamps', async () => {
    const { service, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      handleMessagesUpdate: (events: unknown[]) => Promise<void>;
    };
    sut.currentSocket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async () => undefined),
    };

    await sut.handleMessagesUpdate([
      {
        key: {
          id: 'message-2',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        update: {
          messageTimestamp: 1_700_000_001,
          message: {
            protocolMessage: {
              type: 1,
              editedMessage: { conversation: 'Revisão estável' },
            },
          },
        },
      },
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.any(Object),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
    const publishCall = streamProducerService.send.mock.calls[0] as unknown[];
    const published = publishCall[1] as {
      event_id?: string;
      event_revision?: string;
    };
    expect(published.event_revision).toBeUndefined();
    expect(published.event_id).toBeUndefined();
  });

  it('ignores raw secret encrypted edit upserts because Baileys also emits the decrypted messages.update', async () => {
    const { service, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      processIncomingMessage: (
        socket: unknown,
        message: unknown,
        upsertType: string,
        topic: string
      ) => Promise<void>;
    };
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async () => undefined),
    };
    sut.currentSocket = socket;

    await sut.processIncomingMessage(
      socket,
      {
        key: {
          id: 'secret-edit-event-id',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          secretEncryptedMessage: {
            targetMessageKey: {
              id: 'original-message-id',
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: false,
            },
            secretEncType: 2,
            encPayload: Buffer.from('encrypted-payload'),
            encIv: Buffer.from('iv'),
          },
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      'notify',
      'upsert-message'
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('does not drop new messages when the legacy retry queue is full', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { service, streamProducerService } = makeService();
    const sut = service as unknown as {
      MAX_QUEUE_SIZE: number;
      pendingQueue: unknown[];
      enqueueMessage: (
        inputUpsert: unknown,
        messageKey: string,
        topic: string
      ) => Promise<boolean>;
    };
    sut.MAX_QUEUE_SIZE = 1;
    const existingItem = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'old-message',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'old' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'old-key',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };
    sut.pendingQueue.push(existingItem);

    const result = await sut.enqueueMessage(
      {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'new-message',
            remoteJid: '5511888888888@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'new' },
        },
        photo: null,
        has_quoted: false,
      },
      'new-key',
      'upsert-message'
    );

    expect(result).toBe(true);
    expect(sut.pendingQueue).toEqual([existingItem]);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
      }),
      'account-1:worker-1:5511888888888@s.whatsapp.net'
    );
  });

  it('resolves the Baileys profile photo before publishing the upsert', async () => {
    const { service, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async (jid: string) =>
        jid === '5511999999999@s.whatsapp.net'
          ? 'https://cdn.test/profile.jpg'
          : undefined
      ),
    };
    sut.currentSocket = socket;

    const item = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-1',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'Oi' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-1',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };

    await sut.sendToKafkaWithRetry(item);

    expect(socket.profilePictureUrl).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net',
      'image'
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        photo: 'https://cdn.test/profile.jpg',
      }),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
  });

  it('discards the upsert when its connection epoch is replaced during enrichment', async () => {
    const { service, streamProducerService, whatsappRuntimeFenceService } =
      makeService();
    const sut = service as unknown as {
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    whatsappRuntimeFenceService.isCurrent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await sut.sendToKafkaWithRetry({
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-replaced-epoch',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'Oi' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-replaced-epoch',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    });

    expect(whatsappRuntimeFenceService.isCurrent).toHaveBeenCalledTimes(2);
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('discards presence from a connection epoch replaced before Centrifugo publish', async () => {
    const { service, centrifugoService, whatsappRuntimeFenceService } =
      makeService();
    const sut = service as unknown as {
      handlePresenceUpdate: (data: unknown) => Promise<void>;
    };
    whatsappRuntimeFenceService.isCurrent.mockResolvedValueOnce(false);

    await sut.handlePresenceUpdate({
      id: '5511999999999@s.whatsapp.net',
      presences: {
        '5511999999999@s.whatsapp.net': {
          lastKnownPresence: 'composing',
        },
      },
    });

    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('stops Baileys status retries when the connection epoch is replaced', async () => {
    const { service, streamProducerService, whatsappRuntimeFenceService } =
      makeService();
    const sut = service as unknown as {
      applyStatusPatch: (
        key: { id: string; fromMe: boolean },
        patch: { is_sent: boolean }
      ) => Promise<void>;
    };
    streamProducerService.send.mockRejectedValueOnce(new Error('kafka_down'));
    whatsappRuntimeFenceService.isCurrent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await sut.applyStatusPatch(
      { id: 'status-message-1', fromMe: true },
      { is_sent: true }
    );

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(whatsappRuntimeFenceService.isCurrent).toHaveBeenCalledTimes(2);
  });

  it('reuses a shared cached profile photo without fetching from Baileys', async () => {
    const { service, redisStore, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    const phoneJid = '5511999999999@s.whatsapp.net';
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async () => undefined),
    };
    sut.currentSocket = socket;
    redisStore.set(`photo:jid:${phoneJid}`, 'https://cdn.test/shared.jpg');

    const item = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-shared',
            remoteJid: phoneJid,
            fromMe: false,
          },
          message: { conversation: 'Oi' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-shared',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };

    await sut.sendToKafkaWithRetry(item);

    expect(socket.profilePictureUrl).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        photo: 'https://cdn.test/shared.jpg',
      }),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
  });

  it('ignores legacy shared no-photo cache and still fetches from Baileys', async () => {
    const { service, redisStore, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    const phoneJid = '5511999999999@s.whatsapp.net';
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async (jid: string) =>
        jid === phoneJid
          ? 'https://cdn.test/fetched-after-legacy.jpg'
          : undefined
      ),
    };
    sut.currentSocket = socket;
    redisStore.set(`photo:jid:${phoneJid}`, '__no_photo__');

    const item = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-legacy',
            remoteJid: phoneJid,
            fromMe: false,
          },
          message: { conversation: 'Oi' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-legacy',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };

    await sut.sendToKafkaWithRetry(item);

    expect(socket.profilePictureUrl).toHaveBeenCalledWith(phoneJid, 'image');
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        photo: 'https://cdn.test/fetched-after-legacy.jpg',
      }),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
  });

  it('ignores stale shared WhatsApp photo urls and fetches a fresh one', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { service, redisStore, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    const phoneJid = '5511999999999@s.whatsapp.net';
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async (jid: string) =>
        jid === phoneJid ? 'https://cdn.test/fresh.jpg' : undefined
      ),
    };
    sut.currentSocket = socket;
    redisStore.set(
      `photo:jid:${phoneJid}`,
      'https://pps.whatsapp.net/stale.jpg'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 403,
        headers: {
          'content-type': 'text/html',
        },
      })
    );

    const item = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-stale',
            remoteJid: phoneJid,
            fromMe: false,
          },
          message: { conversation: 'Oi' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-stale',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };

    await sut.sendToKafkaWithRetry(item);

    expect(socket.profilePictureUrl).toHaveBeenCalledWith(phoneJid, 'image');
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        photo: 'https://cdn.test/fresh.jpg',
      }),
      'account-1:worker-1:5511999999999@s.whatsapp.net'
    );
  });

  it('uses contact aliases so an @lid message can fetch photo by phone jid', async () => {
    const { service, redisStore, streamProducerService } = makeService();
    const sut = service as unknown as {
      currentSocket?: unknown;
      upsertContactNames: (contacts: unknown[]) => void;
      sendToKafkaWithRetry: (item: unknown) => Promise<void>;
    };
    const lid = '123456789012345@lid';
    const phoneJid = '5511999999999@s.whatsapp.net';
    const socket = {
      user: { id: '5500000000000@s.whatsapp.net' },
      profilePictureUrl: jest.fn(async (jid: string) =>
        jid === phoneJid ? 'https://cdn.test/lid-profile.jpg' : undefined
      ),
    };
    sut.currentSocket = socket;
    sut.upsertContactNames([
      {
        id: lid,
        lid,
        phoneNumber: '+55 (11) 99999-9999',
        name: 'Maycon Douglas',
      },
    ]);
    redisStore.set(`photo:jid:${lid}`, '__no_photo__');

    const item = {
      inputUpsert: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-2',
            remoteJid: lid,
            fromMe: false,
          },
          message: { conversation: 'Teste' },
        },
        photo: null,
        has_quoted: false,
      },
      messageKey: 'message-key-2',
      topic: 'upsert-message',
      retries: 0,
      addedAt: Date.now(),
    };

    await sut.sendToKafkaWithRetry(item);

    expect(socket.profilePictureUrl).toHaveBeenCalledWith(phoneJid, 'image');
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert-message',
      expect.objectContaining({
        photo: 'https://cdn.test/lid-profile.jpg',
      }),
      'account-1:worker-1:123456789012345@lid'
    );
  });

  it('selects the latest 1000 historical messages globally and returns them chronologically', () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    try {
      const { service } = makeService();
      const sut = service as unknown as {
        activeConnectionScope: { activatedAt: number };
        selectLatestHistoryMessages: (messages: unknown[]) => Array<{
          key?: { id?: string };
        }>;
      };
      sut.activeConnectionScope.activatedAt = Date.now() - 60 * 60 * 1000;
      const nowSeconds = Math.floor(Date.now() / 1000);

      const messages = Array.from({ length: 1005 }, (_, index) => ({
        key: {
          id: `history-${index}`,
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: nowSeconds - 200 + index,
        message: { conversation: `history ${index}` },
      }));

      const selected = sut.selectLatestHistoryMessages(messages);

      expect(selected).toHaveLength(1000);
      expect(selected[0].key?.id).toBe('history-5');
      expect(selected[selected.length - 1].key?.id).toBe('history-1004');
    } finally {
      jest.useRealTimers();
    }
  });

  it('filters non-receivable Baileys history before enforcing the 1000 message limit', () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    try {
      const { service } = makeService();
      const sut = service as unknown as {
        activeConnectionScope: { activatedAt: number };
        selectLatestHistoryMessages: (messages: unknown[]) => Array<{
          key?: { id?: string };
        }>;
      };
      sut.activeConnectionScope.activatedAt = Date.now() - 60 * 60 * 1000;
      const nowSeconds = Math.floor(Date.now() / 1000);

      const ownMessages = Array.from({ length: 100 }, (_, index) => ({
        key: {
          id: `own-${index}`,
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
        messageTimestamp: nowSeconds - index,
        message: { conversation: `own ${index}` },
      }));
      const eligibleMessages = [11, 12, 13].map((value, index) => ({
        key: {
          id: `history-${value}`,
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: nowSeconds - 200 + index,
        message: { conversation: String(value) },
      }));
      const oldMessage = {
        key: {
          id: 'history-too-old',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: nowSeconds - 6 * 60 * 60 - 60,
        message: { conversation: 'too old' },
      };

      const selected = sut.selectLatestHistoryMessages([
        ...ownMessages,
        oldMessage,
        ...eligibleMessages,
      ]);

      expect(selected.map((message) => message.key?.id)).toEqual([
        'history-11',
        'history-12',
        'history-13',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the shared v3 lifecycle for a call auto-reply before invoking Baileys', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const enqueueMessage = jest.fn(async () => true);
    const sut = service as unknown as {
      enqueueMessage: typeof enqueueMessage;
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.enqueueMessage = enqueueMessage;
    const socket = {
      sendMessage: jest.fn(async () => ({
        key: { id: 'sent-call-1' },
      })),
    };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await sut.sendCallAutoReply({
      socket,
      callId: 'physical-call-1',
      callJid: '5511999999999@s.whatsapp.net',
      normalizedJid: '5511999999999@s.whatsapp.net',
      normalizedJidAlt: null,
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(messageSendIdempotencyService.claimOperation).toHaveBeenCalledWith({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'call-auto-reply:worker-1:physical-call-1',
      meta: {
        worker_id: 'worker-1',
        call_id: 'physical-call-1',
        source: 'incoming_call_auto_reply',
      },
    });
    expect(socket.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      messageSendIdempotencyService.markProviderInvoked.mock
        .invocationCallOrder[0]
    ).toBeLessThan(socket.sendMessage.mock.invocationCallOrder[0]);
    expect(socket.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      messageSendIdempotencyService.markSucceeded.mock.invocationCallOrder[0]
    );
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'call-auto-reply:worker-1:physical-call-1',
      }),
      expect.objectContaining({
        kafka_key: 'call_auto_system_sent-call-1',
        call_auto_reply_system_upsert: expect.objectContaining({
          worker_id: 'worker-1',
          account_id: 'account-1',
        }),
      })
    );
  });

  it('releases an accepted auto-reply without waiting for its delivery event', async () => {
    const { service, deliveryConfirmation } = makeService();
    deliveryConfirmation.waitForOutcome.mockReturnValueOnce(
      new Promise(() => undefined)
    );
    const sentMessage = { key: { id: 'accepted-auto-reply' } };
    const socket = {
      sendMessage: jest.fn(async () => sentMessage),
    };

    await expect(
      (service as any).sendMessageWithConfirmation(
        socket,
        '5511999999999@s.whatsapp.net',
        { text: 'Resposta automática' }
      )
    ).resolves.toBe(sentMessage);

    expect(deliveryConfirmation.waitForOutcome).toHaveBeenCalledWith(
      'accepted-auto-reply',
      20_000
    );
  });

  it('does not reject or auto-reply when the call callback epoch was replaced', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    balanceWorkerStatusGrpcClientService.resolveIncomingCallAction.mockResolvedValueOnce(
      {
        reject_call: true,
        show_message_on_call: true,
        show_message_text: 'Não atendemos chamadas.',
      }
    );
    const resolvePhotoForUpsert = jest.fn(async () => undefined);
    const enqueueMessage = jest.fn(async () => true);
    const sendCallAutoReply = jest.fn(async () => undefined);
    const isConnectionScopeCurrent = jest.fn(async () => false);
    const sut = service as unknown as {
      resolvePhotoForUpsert: typeof resolvePhotoForUpsert;
      enqueueMessage: typeof enqueueMessage;
      sendCallAutoReply: typeof sendCallAutoReply;
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      processCallEvent: (socket: unknown, event: unknown) => Promise<void>;
    };
    sut.resolvePhotoForUpsert = resolvePhotoForUpsert;
    sut.enqueueMessage = enqueueMessage;
    sut.sendCallAutoReply = sendCallAutoReply;
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const socket = {
      rejectCall: jest.fn(async () => undefined),
    };

    await sut.processCallEvent(socket, {
      id: 'stale-call-1',
      status: 'offer',
      from: '5511999999999@s.whatsapp.net',
      callerPn: '5511999999999',
    });

    expect(socket.rejectCall).not.toHaveBeenCalled();
    expect(sendCallAutoReply).not.toHaveBeenCalled();
  });

  it('does not leak direct call resolver failures', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.resolveIncomingCallAction.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: '57P01' })
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sut = service as unknown as {
      resolvePhotoForUpsert: (...args: unknown[]) => Promise<undefined>;
      enqueueMessage: (...args: unknown[]) => Promise<boolean>;
      processCallEvent: (socket: unknown, event: unknown) => Promise<void>;
    };
    sut.resolvePhotoForUpsert = jest.fn(async () => undefined);
    sut.enqueueMessage = jest.fn(async () => true);
    const socket = {
      rejectCall: jest.fn(async () => undefined),
    };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await sut.processCallEvent(socket, {
      id: 'call-resolver-error-1',
      status: 'offer',
      from: '5511999999999@s.whatsapp.net',
      callerPn: '5511999999999',
    });

    expect(consoleError).toHaveBeenCalledWith(
      '[CRITICAL] Error processing call event',
      { error_name: 'error', error_code: '57p01' }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });

  it('does not insert an async revocation check between provider_invoked and Baileys send', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const isConnectionScopeCurrent = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sut = service as unknown as {
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const socket = {
      sendMessage: jest.fn(async () => ({
        key: {
          id: 'baileys-after-claim-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
      })),
    };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await expect(
      sut.sendCallAutoReply({
        socket,
        callId: 'stale-call-after-claim',
        callJid: '5511999999999@s.whatsapp.net',
        normalizedJid: '5511999999999@s.whatsapp.net',
        normalizedJidAlt: null,
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).resolves.toBeUndefined();

    expect(socket.sendMessage).toHaveBeenCalledTimes(1);
    expect(isConnectionScopeCurrent).toHaveBeenCalledTimes(2);
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalled();
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalled();
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('does not recover a duplicate call auto-reply after its callback epoch is replaced', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    messageSendIdempotencyService.claimOperation.mockResolvedValueOnce({
      status: 'duplicate',
      state: 'succeeded',
      result: {
        call_auto_reply_system_upsert: {
          worker_id: 'worker-1',
          account_id: 'account-1',
          type: EMessageType.system,
          message: {
            key: {
              id: 'call_auto_system_new-connection',
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: true,
            },
            message: { conversation: 'Não atendemos chamadas.' },
          },
          has_quoted: false,
        },
        kafka_key: 'call_auto_system_new-connection',
      },
    });
    const enqueueMessage = jest.fn(async () => true);
    const isConnectionScopeCurrent = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sut = service as unknown as {
      enqueueMessage: typeof enqueueMessage;
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.enqueueMessage = enqueueMessage;
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const socket = { sendMessage: jest.fn() };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await sut.sendCallAutoReply({
      socket,
      callId: 'duplicate-after-reconnect',
      callJid: '5511999999999@s.whatsapp.net',
      normalizedJid: '5511999999999@s.whatsapp.net',
      normalizedJidAlt: null,
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(socket.sendMessage).not.toHaveBeenCalled();
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('recovers a succeeded call auto-reply without sending it to Baileys again', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const savedUpsert = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      type: EMessageType.system,
      message: {
        key: {
          id: 'call_auto_system_saved',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
        message: { conversation: 'Não atendemos chamadas.' },
        messageTimestamp: 1_700_000_000,
      },
      has_quoted: false,
      photo: null,
    };
    messageSendIdempotencyService.claimOperation.mockResolvedValueOnce({
      status: 'duplicate',
      state: 'succeeded',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'call-auto-reply:worker-1:physical-call-1',
      key: 'claim:saved',
      owner: null,
      result: {
        call_auto_reply_system_upsert: savedUpsert,
        kafka_key: 'call_auto_system_saved',
      },
    });
    const enqueueMessage = jest.fn(async () => true);
    const sut = service as unknown as {
      enqueueMessage: typeof enqueueMessage;
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.enqueueMessage = enqueueMessage;
    const socket = { sendMessage: jest.fn() };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await sut.sendCallAutoReply({
      socket,
      callId: 'physical-call-1',
      callJid: '5511999999999@s.whatsapp.net',
      normalizedJid: '5511999999999@s.whatsapp.net',
      normalizedJidAlt: null,
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(socket.sendMessage).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(enqueueMessage).toHaveBeenCalledWith(
      savedUpsert,
      'call_auto_system_saved'
    );
  });

  it('accepts two distinct calls with identical auto-reply text', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const sut = service as unknown as {
      enqueueMessage: jest.Mock<Promise<boolean>, [unknown, string]>;
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.enqueueMessage = jest.fn(
      async (_upsert: unknown, _kafkaKey: string) => true
    );
    const socket = {
      sendMessage: jest
        .fn()
        .mockResolvedValueOnce({ key: { id: 'sent-call-a' } })
        .mockResolvedValueOnce({ key: { id: 'sent-call-b' } }),
    };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;
    const common = {
      socket,
      callJid: '5511999999999@s.whatsapp.net',
      normalizedJid: '5511999999999@s.whatsapp.net',
      normalizedJidAlt: null,
      text: 'Não atendemos chamadas.',
      photo: null,
    };

    await sut.sendCallAutoReply({ ...common, callId: 'physical-call-a' });
    await sut.sendCallAutoReply({ ...common, callId: 'physical-call-b' });

    expect(socket.sendMessage).toHaveBeenCalledTimes(2);
    expect(
      messageSendIdempotencyService.claimOperation.mock.calls.map(
        ([input]) => input.operationId
      )
    ).toEqual([
      'call-auto-reply:worker-1:physical-call-a',
      'call-auto-reply:worker-1:physical-call-b',
    ]);
  });

  it('marks the call auto-reply ambiguous after Baileys invocation fails', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const sut = service as unknown as {
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    const providerError = new Error('provider uncertain');
    const socket = {
      sendMessage: jest.fn(async () => Promise.reject(providerError)),
    };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await expect(
      sut.sendCallAutoReply({
        socket,
        callId: 'physical-call-ambiguous',
        callJid: '5511999999999@s.whatsapp.net',
        normalizedJid: '5511999999999@s.whatsapp.net',
        normalizedJidAlt: null,
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).rejects.toBe(providerError);

    expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'call-auto-reply:worker-1:physical-call-ambiguous',
      }),
      providerError
    );
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markSucceeded).not.toHaveBeenCalled();
  });

  it('keeps a call auto-reply fail-closed when provider-invoked CAS applies but its response is lost', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    let durableState = 'reserved';
    messageSendIdempotencyService.markProviderInvoked.mockImplementationOnce(
      async () => {
        durableState = 'provider_invoked';
        throw new Error('redis response lost after CAS');
      }
    );
    const sut = service as unknown as {
      sendCallAutoReply: (input: {
        socket: unknown;
        callId: string;
        callJid: string;
        normalizedJid: string;
        normalizedJidAlt: string | null;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    const socket = { sendMessage: jest.fn() };
    (service as unknown as { currentSocket: unknown }).currentSocket = socket;

    await expect(
      sut.sendCallAutoReply({
        socket,
        callId: 'physical-call-release',
        callJid: '5511999999999@s.whatsapp.net',
        normalizedJid: '5511999999999@s.whatsapp.net',
        normalizedJidAlt: null,
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).rejects.toThrow('redis response lost after CAS');

    expect(durableState).toBe('provider_invoked');
    expect(socket.sendMessage).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.revertProviderInvocationBeforeStart
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('bounds mark-read to one provider flight and recovers only with a new socket', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service } = makeService();
      let resolveLate!: () => void;
      const socket = {
        ev: new EventEmitter(),
        readMessages: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveLate = resolve;
            })
        ),
      };
      service.bindTo(socket as never);

      const first = service.markRead([
        { id: 'message-1', remoteJid: '5511999999999@s.whatsapp.net' },
      ]);
      const rejection = expect(first).rejects.toMatchObject({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'mark_read',
      });
      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      await expect(
        service.markRead([
          { id: 'message-1', remoteJid: '5511999999999@s.whatsapp.net' },
        ])
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(socket.readMessages).toHaveBeenCalledTimes(1);

      resolveLate();
      await Promise.resolve();
      await Promise.resolve();
      await expect(
        service.markRead([
          { id: 'message-1', remoteJid: '5511999999999@s.whatsapp.net' },
        ])
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(socket.readMessages).toHaveBeenCalledTimes(1);

      const freshSocket = {
        ev: new EventEmitter(),
        readMessages: jest.fn(async () => undefined),
      };
      service.bindTo(freshSocket as never);
      await expect(
        service.markRead([
          { id: 'message-1', remoteJid: '5511999999999@s.whatsapp.net' },
        ])
      ).resolves.toBeUndefined();
      expect(freshSocket.readMessages).toHaveBeenCalledTimes(1);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
      } else {
        process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });
});
