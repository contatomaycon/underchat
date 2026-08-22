import 'reflect-metadata';

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

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  Message: class {},
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
    runtimeGeneration: 7,
  },
  generalEnvironment: {
    automationSendDedupeTtlSeconds: 60,
  },
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid?: string | null) =>
    jid ? jid.replace(/@c\.us$/, '@s.whatsapp.net') : undefined,
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

jest.mock('@core/services/messageStatus.service', () => ({
  MessageStatusService: class {
    static statusKafkaKey(accountId: string, messageId: string) {
      return `${accountId}:${messageId}`;
    }
  },
}));

jest.mock('@core/services/wwebjs/methods/upsertMediaEnricher.service', () => ({
  WwebjsUpsertMediaEnricher: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/wwebjs/methods/deliveryConfirmation.service', () => ({
  WwebjsDeliveryConfirmationService: class {},
}));

import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { IInboundMessageSpoolPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';
import { ObsoleteInboundMessageSpoolPayloadError } from '@core/services/inboundMessageSpool.service';

type WwebjsIncomingMessageServicePrivate = {
  bindTo: (client: unknown) => void;
  markRead: (
    keys: Array<{
      id?: string;
      remoteJid?: string | null;
      remote_jid?: string | null;
    }>
  ) => Promise<void>;
  resolvePhotoForMessage: (
    client: unknown,
    msg: unknown,
    resolvedJids: { remoteJid: string; remoteJidAlt?: string }
  ) => Promise<string | undefined>;
  KAFKA_RETRY_MAX_ATTEMPTS: number;
  kafkaRetryQueue: unknown[];
  processKafkaRetryQueue: () => Promise<void>;
  sendToKafkaWithRetry: (
    topic: string,
    payload: unknown,
    metadata: {
      event: string;
      messageId?: string;
      messageKeyId?: string;
    },
    kafkaKey?: string
  ) => Promise<boolean>;
};

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function spoolPayload(
  overrides: Partial<IInboundMessageSpoolPayload> = {}
): IInboundMessageSpoolPayload {
  return {
    provider: 'wwebjs',
    source_provider: 'wwebjs',
    account_id: 'account-w',
    worker_id: 'worker-w',
    runtime_generation: '6',
    connection_epoch: 'previous-epoch',
    event_source: 'message',
    dedupe_key: 'inbound-event-1',
    kafka_topic: 'upsert-message',
    kafka_key: 'account-w:worker-w:chat-1',
    upsert: {
      event_id: 'inbound-event-1',
      worker_id: 'worker-w',
      account_id: 'account-w',
      source_provider: 'wwebjs',
      runtime_generation: '6',
      connection_epoch: 'previous-epoch',
      type: EMessageType.text,
      message: {
        key: { id: 'message-1', remoteJid: '5511999999999@c.us' },
        message: { conversation: 'hello' },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      has_quoted: false,
    },
    received_at: new Date().toISOString(),
    attempts: 0,
    ...overrides,
  };
}

describe('WwebjsIncomingMessageService runtime transition ordering', () => {
  it('reuses the manager-authorized epoch and attempt for client activation', async () => {
    const durableActivation = jest.fn(async () => ({
      connection_sequence: 9,
      already_active: true,
    }));
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.currentConnectionAuthorization = {
      connection_epoch: '33333333-3333-4333-8333-333333333333',
      connection_attempt_id: '44444444-4444-4444-8444-444444444444',
    };
    service.whatsappRuntimeFenceService = {
      beginActivation: jest.fn(async () => ({
        status: 'acquired',
        activation_order: 1,
        activated_at: 1000,
        connection_sequence: 0,
      })),
      finalizeActivation: jest.fn(async () => true),
      deactivate: jest.fn(async () => true),
      isCurrent: jest.fn(async () => true),
    };
    service.balanceWorkerStatusGrpcClientService = {
      activateWhatsappRuntimeFence: durableActivation,
    };
    service.inboundMessageSpoolService = {
      startPublisher: jest.fn(),
      stopPublisher: jest.fn(async () => undefined),
    };
    service.runtimeFenceTransition = Promise.resolve();

    const scope = service.activateConnectionScope();
    await expect(scope.activation).resolves.toBe(true);

    expect(durableActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_epoch: '33333333-3333-4333-8333-333333333333',
        connection_attempt_id: '44444444-4444-4444-8444-444444444444',
      })
    );
  });

  it('prepares the runtime fence without opening the incoming event bridge', async () => {
    const client = {};
    const connectionScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'prepared-epoch',
      activation: Promise.resolve(true),
    };
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.currentClient = client;
    service.connectionReady = false;
    service.activeConnectionScope = undefined;
    service.activateConnectionScope = jest.fn(() => {
      service.activeConnectionScope = connectionScope;
      return connectionScope;
    });

    await expect(service.prepareConnectionFence()).resolves.toBe(true);

    expect(service.activateConnectionScope).toHaveBeenCalledTimes(1);
    expect(service.activeConnectionScope).toBe(connectionScope);
    expect(service.connectionReady).toBe(false);
  });

  it('acquires worker effects only for its own active connection epoch', async () => {
    const acquireEffectLease = jest.fn(async (input) =>
      runtimeEffectLease(input)
    );
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.whatsappRuntimeFenceService = { acquireEffectLease };
    service.activeConnectionScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'wwebjs-local-epoch',
      activation: Promise.resolve(true),
    };

    await expect(
      service.acquireActiveRuntimeEffectLease()
    ).resolves.not.toBeNull();
    expect(acquireEffectLease).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_generation: 7,
        connection_epoch: 'wwebjs-local-epoch',
        source_provider: 'wwebjs',
      })
    );
  });

  it('deactivates a stopped epoch before activating its replacement', async () => {
    const firstFinalization = deferredBoolean();
    const runtimeFence = {
      beginActivation: jest
        .fn()
        .mockResolvedValueOnce({
          status: 'acquired',
          activation_order: 1,
          activated_at: 1000,
          connection_sequence: 0,
        })
        .mockResolvedValueOnce({
          status: 'acquired',
          activation_order: 2,
          activated_at: 2000,
          connection_sequence: 0,
        }),
      finalizeActivation: jest
        .fn()
        .mockImplementationOnce(() => firstFinalization.promise)
        .mockResolvedValueOnce(true),
      deactivate: jest.fn(async () => true),
      isCurrent: jest.fn(async () => true),
      acquireEffectLease: jest.fn(async (input) => runtimeEffectLease(input)),
      acquireActiveEffectLease: jest.fn(async () => runtimeEffectLease()),
    };
    const spool = {
      startPublisher: jest.fn(),
      stopPublisher: jest.fn(async () => undefined),
    };
    const durableActivation = jest.fn(async () => ({
      connection_sequence: 1,
      already_active: false,
    }));
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.whatsappRuntimeFenceService = runtimeFence;
    service.balanceWorkerStatusGrpcClientService = {
      activateWhatsappRuntimeFence: durableActivation,
    };
    service.inboundMessageSpoolService = spool;
    service.runtimeFenceTransition = Promise.resolve();

    const firstScope = service.activateConnectionScope();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runtimeFence.beginActivation).toHaveBeenCalledTimes(1);
    expect(runtimeFence.finalizeActivation).toHaveBeenCalledTimes(1);

    service.stopActiveConnectionScope();
    const secondScope = service.activateConnectionScope();
    firstFinalization.resolve(true);

    await expect(firstScope.activation).resolves.toBe(false);
    await expect(secondScope.activation).resolves.toBe(true);

    expect(runtimeFence.beginActivation).toHaveBeenCalledTimes(2);
    expect(runtimeFence.finalizeActivation).toHaveBeenCalledTimes(2);
    expect(durableActivation).toHaveBeenCalledTimes(2);
    expect(
      runtimeFence.beginActivation.mock.invocationCallOrder[0]
    ).toBeLessThan(durableActivation.mock.invocationCallOrder[0]);
    expect(durableActivation.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeFence.finalizeActivation.mock.invocationCallOrder[0]
    );
    expect(runtimeFence.deactivate).toHaveBeenCalledWith(
      'worker-w',
      7,
      firstScope.connectionEpoch
    );
    expect(
      runtimeFence.deactivate.mock.invocationCallOrder.at(-1)
    ).toBeLessThan(runtimeFence.beginActivation.mock.invocationCallOrder[1]);
    expect(service.activeConnectionScope).toBe(secondScope);
  });

  it('keeps the same connection epoch and retries when Balance returns after a transient outage', async () => {
    const runtimeFence = {
      beginActivation: jest.fn(async () => ({
        status: 'acquired',
        activation_order: 1,
        activated_at: 1000,
        connection_sequence: 0,
      })),
      finalizeActivation: jest.fn(async () => true),
      deactivate: jest.fn(async () => true),
      isCurrent: jest.fn(async () => true),
    };
    const durableActivation = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({
        connection_sequence: 9,
        already_active: false,
      });
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.whatsappRuntimeFenceService = runtimeFence;
    service.balanceWorkerStatusGrpcClientService = {
      activateWhatsappRuntimeFence: durableActivation,
    };
    service.inboundMessageSpoolService = {
      startPublisher: jest.fn(),
      stopPublisher: jest.fn(async () => undefined),
    };
    service.runtimeFenceTransition = Promise.resolve();

    const scope = service.activateConnectionScope();

    await expect(scope.activation).resolves.toBe(true);
    expect(durableActivation).toHaveBeenCalledTimes(2);
    expect(runtimeFence.beginActivation).toHaveBeenCalledTimes(2);
    expect(runtimeFence.finalizeActivation).toHaveBeenCalledTimes(1);
    expect(runtimeFence.deactivate).not.toHaveBeenCalled();
    expect(scope.connectionSequence).toBe(9);
    expect(service.activeConnectionScope).toBe(scope);
  });
});

describe('WwebjsIncomingMessageService durable spool fencing', () => {
  const makeService = () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const acquireEffectLease = jest.fn(
      async (
        input: unknown
      ): Promise<ReturnType<typeof runtimeEffectLease> | null> =>
        runtimeEffectLease(input)
    );
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
      acquireEffectLease,
    };
    const service = Object.create(
      WwebjsIncomingMessageService.prototype
    ) as any;
    service.streamProducerService = streamProducerService;
    service.whatsappRuntimeFenceService = runtimeFence;
    service.connectionScopeStorage = { getStore: () => undefined };
    service.activeConnectionScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'current-epoch',
      activation: Promise.resolve(true),
    };
    return { service, streamProducerService, runtimeFence };
  };

  it('marks an expired payload terminal only after the authoritative fence proves its scope was superseded', async () => {
    const { service, streamProducerService, runtimeFence } = makeService();
    const expired = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: {
          ...spoolPayload().upsert.message,
          messageTimestamp: Math.floor(
            (Date.now() - 7 * 60 * 60 * 1000) / 1000
          ),
        },
      },
    });

    await expect(service.publishSpoolPayload(expired)).rejects.toBeInstanceOf(
      ObsoleteInboundMessageSpoolPayloadError
    );

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_generation: 7,
        connection_epoch: 'current-epoch',
        source_provider: 'wwebjs',
      })
    );
    expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('keeps a superseded but recent payload replayable through the current runtime', async () => {
    const { service, streamProducerService } = makeService();
    const payload = spoolPayload();

    await expect(service.publishSpoolPayload(payload)).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      payload.kafka_topic,
      expect.objectContaining({
        runtime_generation: '7',
        connection_epoch: 'current-epoch',
        from_history_sync: true,
      }),
      payload.kafka_key
    );
  });

  it('continues retrying a lease rejection for the current runtime', async () => {
    const { service, streamProducerService, runtimeFence } = makeService();
    runtimeFence.acquireEffectLease.mockResolvedValueOnce(null);
    const current = spoolPayload({
      runtime_generation: '7',
      connection_epoch: 'current-epoch',
      upsert: {
        ...spoolPayload().upsert,
        runtime_generation: '7',
        connection_epoch: 'current-epoch',
      },
    });

    const rejection = service.publishSpoolPayload(current);
    await expect(rejection).rejects.toThrow(
      'wwebjs_inbound_spool_runtime_lease_revoked'
    );
    await expect(rejection).rejects.not.toBeInstanceOf(
      ObsoleteInboundMessageSpoolPayloadError
    );
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('never terminalizes an old payload when the authoritative active fence is not confirmed', async () => {
    const { service, streamProducerService, runtimeFence } = makeService();
    runtimeFence.isCurrent.mockResolvedValue(false);
    const payload = spoolPayload({
      upsert: {
        ...spoolPayload().upsert,
        message: null as never,
      },
    });

    const rejection = service.publishSpoolPayload(payload);
    await expect(rejection).rejects.toThrow(
      'wwebjs_inbound_spool_runtime_lease_revoked'
    );
    await expect(rejection).rejects.not.toBeInstanceOf(
      ObsoleteInboundMessageSpoolPayloadError
    );
    expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });
});

describe('WwebjsIncomingMessageService profile photo cache', () => {
  const makeService = () => {
    const redisStore = new Map<string, string>();
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const messageSendIdempotencyService = {
      claimOperation: jest.fn(async (): Promise<unknown> => ({
        status: 'error',
      })),
      markProviderInvoked: jest.fn(async () => 'transitioned'),
      markSucceeded: jest.fn(async () => 'transitioned'),
      markAmbiguous: jest.fn(async () => 'transitioned'),
      releaseReservation: jest.fn(async () => 'transitioned'),
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
    const balanceWorkerStatusGrpcClientService = {
      activateWhatsappRuntimeFence: jest.fn(async () => ({
        connection_sequence: 1,
        already_active: false,
      })),
      resolveIncomingCallAction: jest.fn(async () => ({
        reject_call: false,
        show_message_on_call: false,
      })),
    };
    const service = new WwebjsIncomingMessageService(
      streamProducerService as never,
      { upsertMessage: jest.fn(() => 'upsert-message') } as never,
      redis as never,
      { enrich: jest.fn(async () => undefined) } as never,
      balanceWorkerStatusGrpcClientService as never,
      { waitForOutcome: jest.fn(async () => 'sent') } as never,
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

    return {
      service: service as unknown as WwebjsIncomingMessageServicePrivate,
      redis,
      redisStore,
      streamProducerService,
      whatsappRuntimeFenceService,
      balanceWorkerStatusGrpcClientService,
    };
  };

  const makeClient = (
    getProfilePicUrl: (jid: string) => Promise<string | undefined>
  ) => ({
    info: {
      wid: {
        _serialized: '5500000000000@c.us',
      },
    },
    getProfilePicUrl: jest.fn(getProfilePicUrl),
  });

  const makeMessage = (
    remoteJid: string,
    contactProfilePicUrl: () => Promise<string | undefined> = async () =>
      undefined
  ) => ({
    id: {
      remoteJid,
      _serialized: `false_${remoteJid}_message-1`,
    },
    fromMe: false,
    from: remoteJid,
    to: '5500000000000@c.us',
    getContact: jest.fn(async () => ({
      getProfilePicUrl: jest.fn(contactProfilePicUrl),
    })),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses a shared cached profile photo without fetching from WWebJS', async () => {
    const { service, redisStore } = makeService();
    const phoneJid = '5511999999999@s.whatsapp.net';
    const client = makeClient(async () => undefined);
    const msg = makeMessage(phoneJid);
    redisStore.set(`photo:jid:${phoneJid}`, 'https://cdn.test/shared.jpg');

    await expect(
      service.resolvePhotoForMessage(client, msg, { remoteJid: phoneJid })
    ).resolves.toBe('https://cdn.test/shared.jpg');

    expect(client.getProfilePicUrl).not.toHaveBeenCalled();
    expect(msg.getContact).not.toHaveBeenCalled();
  });

  it('ignores legacy shared no-photo cache and still fetches from WWebJS', async () => {
    const { service, redisStore } = makeService();
    const phoneJid = '5511999999999@s.whatsapp.net';
    const client = makeClient(async (jid: string) =>
      jid === phoneJid ? 'https://cdn.test/fetched.jpg' : undefined
    );
    const msg = makeMessage(phoneJid);
    redisStore.set(`photo:jid:${phoneJid}`, '__no_photo__');

    await expect(
      service.resolvePhotoForMessage(client, msg, { remoteJid: phoneJid })
    ).resolves.toBe('https://cdn.test/fetched.jpg');

    expect(client.getProfilePicUrl).toHaveBeenCalledWith(phoneJid);
  });

  it('ignores stale shared WhatsApp photo urls and fetches a fresh one', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { service, redisStore } = makeService();
    const phoneJid = '5511999999999@s.whatsapp.net';
    const client = makeClient(async (jid: string) =>
      jid === phoneJid ? 'https://cdn.test/fresh.jpg' : undefined
    );
    const msg = makeMessage(phoneJid);
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

    await expect(
      service.resolvePhotoForMessage(client, msg, { remoteJid: phoneJid })
    ).resolves.toBe('https://cdn.test/fresh.jpg');

    expect(client.getProfilePicUrl).toHaveBeenCalledWith(phoneJid);
  });

  it('does not let one local no-photo candidate block untested candidates', async () => {
    const { service, redisStore } = makeService();
    const firstJid = '5511888888888@s.whatsapp.net';
    const secondJid = '5511999999999@s.whatsapp.net';
    const client = makeClient(async (jid: string) =>
      jid === secondJid ? 'https://cdn.test/second.jpg' : undefined
    );
    const msg = makeMessage(firstJid);
    redisStore.set(`photo:no-photo:wwebjs:jid:${firstJid}`, '__no_photo__');

    await expect(
      service.resolvePhotoForMessage(client, msg, {
        remoteJid: firstJid,
        remoteJidAlt: secondJid,
      })
    ).resolves.toBe('https://cdn.test/second.jpg');

    expect(client.getProfilePicUrl).toHaveBeenCalledWith(secondJid);
  });

  it('stores no-photo only in the WWebJS local negative cache', async () => {
    const { service, redisStore } = makeService();
    const phoneJid = '5511999999999@s.whatsapp.net';
    const client = makeClient(async () => undefined);
    const msg = makeMessage(phoneJid);

    await expect(
      service.resolvePhotoForMessage(client, msg, { remoteJid: phoneJid })
    ).resolves.toBeUndefined();

    expect(redisStore.get(`photo:jid:${phoneJid}`)).toBeUndefined();
    expect(redisStore.get(`photo:no-photo:wwebjs:jid:${phoneJid}`)).toBe(
      '__no_photo__'
    );
  });

  it('discards retry queue items after the configured publish attempts', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { service, streamProducerService } = makeService();
    streamProducerService.send.mockRejectedValueOnce(new Error('kafka_down'));
    service.KAFKA_RETRY_MAX_ATTEMPTS = 4;
    service.kafkaRetryQueue = [
      {
        topic: 'upsert-message',
        payload: {
          worker_id: 'worker-w',
          account_id: 'account-w',
          source_provider: 'wwebjs',
          type: EMessageType.text,
          has_quoted: false,
          message: {
            key: {
              id: 'message-1',
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: false,
            },
            message: { conversation: 'Oi' },
          },
        },
        kafkaKey: 'account-w:worker-w:5511999999999@s.whatsapp.net',
        metadata: {
          event: 'incoming_upsert',
          messageId: 'message-1',
          messageKeyId: 'message-1',
        },
        attempts: 3,
        nextAttemptAt: Date.now() - 1,
      },
    ];

    await service.processKafkaRetryQueue();

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(service.kafkaRetryQueue).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      '[wwebjs] Discarding kafka retry item:',
      expect.objectContaining({
        reason: 'retry_exhausted',
        attempts: 4,
        max_attempts: 4,
      })
    );
  });

  it('stops immediate retries when the connection epoch is replaced', async () => {
    const { service, streamProducerService, whatsappRuntimeFenceService } =
      makeService();
    streamProducerService.send.mockRejectedValueOnce(new Error('kafka_down'));
    whatsappRuntimeFenceService.isCurrent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      service.sendToKafkaWithRetry(
        'update.message.status',
        {
          account_id: 'account-w',
          worker_id: 'worker-w',
          message_id: 'message-status-1',
          patch: { is_sent: true },
        },
        {
          event: 'message_ack',
          messageId: 'message-status-1',
          messageKeyId: 'message-status-1',
        },
        'account-w:worker-w:message-status-1'
      )
    ).resolves.toBe(false);

    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(service.kafkaRetryQueue).toHaveLength(0);
  });

  it('bounds sendSeen to one provider flight and only clears the fence on a new client', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service } = makeService();
      let resolveLate!: () => void;
      const client = {
        on: jest.fn().mockReturnThis(),
        sendSeen: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveLate = resolve;
            })
        ),
      };
      service.bindTo(client as never);
      const keys = [
        {
          id: 'message-1',
          remoteJid: '5511999999999@c.us',
        },
      ];

      const first = service.markRead(keys);
      const rejection = expect(first).rejects.toMatchObject({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'mark_read',
      });
      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      await expect(service.markRead(keys)).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
      });
      expect(client.sendSeen).toHaveBeenCalledTimes(1);

      resolveLate();
      await Promise.resolve();
      await Promise.resolve();
      await expect(service.markRead(keys)).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
      });
      expect(client.sendSeen).toHaveBeenCalledTimes(1);

      const freshClient = {
        on: jest.fn().mockReturnThis(),
        sendSeen: jest.fn(async () => undefined),
      };
      service.bindTo(freshClient as never);
      await expect(service.markRead(keys)).resolves.toBeUndefined();
      expect(freshClient.sendSeen).toHaveBeenCalledTimes(1);
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

describe('WwebjsIncomingMessageService ad message_edit replay', () => {
  const selfJid = '5517991552458@c.us';
  const phoneJid = '556999715039@s.whatsapp.net';
  const lidJid = '6352894177535@lid';
  const contactInfoTo = '205127956844693:15@lid';
  const adMessageId = '3A7E64CFE62F38192A29';
  const adSerializedId = `false_${lidJid}_${adMessageId}`;
  const e2eSerializedId = `false_${lidJid}_3EB086C68C75A88D1F23`;
  const contactCardSerializedId = `false_${lidJid}_3EB0FA10AEA02E9B21D2`;
  const adBody =
    'Olá! Gostaria de saber sobre a Pós-Graduação EAD com um atendimento humanizado!';
  const ciphertextFallbackBody =
    'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';

  class FakeWwebjsClient {
    readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly info = {
      wid: {
        _serialized: selfJid,
      },
    };
    readonly getProfilePicUrl = jest.fn(async () => undefined);
    readonly getContactById = jest.fn(async () => ({
      isMe: false,
      pushname: 'Luh',
      getProfilePicUrl: jest.fn(async () => undefined),
    }));
    readonly getContactLidAndPhone = jest.fn(async () => [
      {
        lid: lidJid,
        pn: phoneJid,
      },
    ]);
    readonly onWhatsApp = jest.fn(async () => [
      {
        exists: true,
        jid: phoneJid,
      },
    ]);

    on(event: string, handler: (...args: unknown[]) => void): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  const makeService = () => {
    const redisStore = new Map<string, string>();
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    const streamProducerService = {
      send: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const kafkaServiceQueueService = {
      upsertMessage: jest.fn(() => 'upsert-message'),
      upsertMessageHistory: jest.fn(() => 'upsert-message-history'),
      updateMessageStatus: jest.fn(() => 'update-message-status'),
    };
    let deliveryOutcome: 'sent' | 'failed' = 'sent';
    const deliveryConfirmation = {
      waitForOutcome: jest.fn(async () => deliveryOutcome),
      markFailed: jest.fn(() => {
        deliveryOutcome = 'failed';
        return true;
      }),
      markSent: jest.fn(() => {
        deliveryOutcome = 'sent';
        return true;
      }),
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
          owner: 'owner-w',
          result: null,
        })
      ),
      markProviderInvoked: jest.fn(async () => 'transitioned'),
      revertProviderInvocationBeforeStart: jest.fn(async () => 'transitioned'),
      markSucceeded: jest.fn(async () => 'transitioned'),
      markAmbiguous: jest.fn(async () => 'transitioned'),
      releaseReservation: jest.fn(async () => 'transitioned'),
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
    const service = new WwebjsIncomingMessageService(
      streamProducerService as never,
      kafkaServiceQueueService as never,
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

    return {
      service,
      streamProducerService,
      kafkaServiceQueueService,
      deliveryConfirmation,
      balanceWorkerStatusGrpcClientService,
      messageSendIdempotencyService,
      whatsappRuntimeFenceService,
    };
  };

  const makeLogMessage = (input: {
    serializedId: string;
    fromMe: boolean;
    type: string;
    body?: string;
    subtype?: string;
    from: string;
    to: string;
    timestamp?: number;
    ack?: number;
    author?: string;
    idFromMe?: boolean;
    isNewMsg?: boolean;
    recvFresh?: boolean;
    ctwaContext?: Record<string, unknown>;
  }) => {
    const idFromMe = input.idFromMe ?? input.fromMe;
    const id = {
      fromMe: idFromMe,
      remote: lidJid,
      id: input.serializedId.split('_').at(-1),
      _serialized: input.serializedId,
      remoteJid: phoneJid,
      name: null,
    };
    const body = input.body ?? '';
    const message = {
      _data: {
        id,
        body,
        type: input.type,
        subtype: input.subtype,
        t: input.timestamp ?? Math.floor(Date.now() / 1000),
        from: input.from,
        to: input.to,
        ack: input.ack,
        isNewMsg: input.isNewMsg,
        recvFresh: input.recvFresh,
        notifyName: input.fromMe ? '' : 'Luh',
        ctwaContext: input.ctwaContext,
      },
      id,
      ack: input.ack,
      hasMedia: false,
      body,
      type: input.type,
      timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
      from: input.from,
      to: input.to,
      author: input.author,
      isNewMsg: input.isNewMsg,
      recvFresh: input.recvFresh,
      deviceType: input.fromMe ? 'android' : 'ios',
      fromMe: input.fromMe,
      hasQuotedMsg: false,
      hasReaction: false,
      getContact: jest.fn(async () => ({
        pushname: 'Luh',
        getProfilePicUrl: jest.fn(async () => undefined),
      })),
      getChat: jest.fn(async () => ({
        name: '+55 69 9971-5039',
      })),
      getQuotedMessage: jest.fn(async () => undefined),
    };

    return message;
  };

  const makeReactionEvent = (input: {
    reactionId?: string;
    parentMsgId?: string;
    emoji?: string;
    senderId?: string;
    timestamp?: number;
  }) => ({
    id: {
      _serialized: input.reactionId ?? `false_${lidJid}_reaction-1`,
      fromMe: false,
      remote: lidJid,
      id: 'reaction-1',
      participant: input.senderId ?? lidJid,
    },
    msgId: {
      _serialized: input.parentMsgId ?? `false_${lidJid}_parent-1`,
      fromMe: false,
      remote: lidJid,
      id: 'parent-1',
    },
    reaction: input.emoji ?? '👍',
    senderId: input.senderId ?? lidJid,
    timestamp: input.timestamp,
  });

  const adCtwaContext = {
    conversionSource: 'FB_Ads',
    ctwaSignals: 'all,all',
    sourceUrl: 'https://fb.me/6G4qyAUIJ',
    description:
      'Você já concluiu a graduação e quer ir além, mas sem enrolação?',
    title: 'Pós-Graduação EAD',
    mediaType: 1,
    sourceApp: 'facebook',
    greetingMessageBody: 'Olá! Diga como podemos ajudar você.',
    automatedGreetingMessageShown: true,
    sourceId: '120241701325990384',
    originalImageUrl: 'https://www.facebook.com/ads/image/?d=example',
  };

  const makeAdMessage = (type: string, body = '', subtype?: string) =>
    makeLogMessage({
      serializedId: adSerializedId,
      fromMe: false,
      type,
      body,
      subtype,
      from: lidJid,
      to: selfJid,
      ack: 1,
      ctwaContext: body ? adCtwaContext : undefined,
    });

  const makeUnreadCount = (
    lastMessage: Record<string, unknown>,
    unreadCount: number
  ) => ({
    id: {
      server: 'lid',
      user: lidJid.replace('@lid', ''),
      _serialized: lidJid,
    },
    name: '+55 69 9971-5039',
    isGroup: false,
    unreadCount,
    timestamp: 1778190016,
    pinned: false,
    isMuted: false,
    muteExpiration: 0,
    lastMessage,
  });

  const makeChatState = () => ({
    chatId: lidJid,
    userId: lidJid,
    state: 'unavailable',
    isOnline: false,
    isGroup: false,
    typingUserIds: [],
    recordingUserIds: [],
    timestamp: null,
    deny: null,
    stale: true,
    isSubscribed: true,
    hasData: false,
    trigger: 'chatstate_change_type',
  });

  const makeE2ENotification = () =>
    makeLogMessage({
      serializedId: e2eSerializedId,
      fromMe: false,
      type: 'e2e_notification',
      subtype: 'encrypt',
      from: lidJid,
      to: contactInfoTo,
    });

  const makeContactInfoCard = () =>
    makeLogMessage({
      serializedId: contactCardSerializedId,
      fromMe: false,
      type: 'notification_template',
      subtype: 'contact_info_card',
      from: lidJid,
      to: contactInfoTo,
    });

  it('keeps history reconciliation disabled when explicitly disabled', () => {
    process.env.HISTORY_RECONCILIATION_ENABLED = 'false';
    try {
      const { service } = makeService();
      const sut = service as unknown as {
        isHistoricalMessageEvent: (
          message: unknown,
          source: 'message'
        ) => boolean;
      };

      expect(
        sut.isHistoricalMessageEvent(
          makeLogMessage({
            serializedId: `false_${lidJid}_history-disabled`,
            fromMe: false,
            type: 'chat',
            body: 'must not reconcile',
            from: lidJid,
            to: selfJid,
            timestamp: Math.floor(Date.now() / 1000),
            isNewMsg: false,
          }),
          'message'
        )
      ).toBe(false);
    } finally {
      process.env.HISTORY_RECONCILIATION_ENABLED = 'true';
    }
  });

  const flushAsyncHandlers = async () => {
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const flushMicrotasks = async () => {
    for (let index = 0; index < 100; index += 1) {
      await Promise.resolve();
    }
  };

  it('keeps a raw outbound ACK error provisional instead of publishing a durable failure', async () => {
    const { service, streamProducerService, deliveryConfirmation } =
      makeService();
    const serializedId = `true_${lidJid}_late-failure`;
    const message = makeLogMessage({
      serializedId,
      fromMe: true,
      type: 'chat',
      body: 'Outbound',
      from: selfJid,
      to: lidJid,
      ack: -1,
    });

    await (service as any).handleMessageAck(message, -1);

    expect(deliveryConfirmation.markFailed).toHaveBeenCalledWith(serializedId);
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('recovers when ACK error arrives before a successful auto-reply send result', async () => {
    const { service, streamProducerService, deliveryConfirmation } =
      makeService();
    const serializedId = `true_${lidJid}_auto-reply-race`;
    const message = makeLogMessage({
      serializedId,
      fromMe: true,
      type: 'chat',
      body: 'Auto reply',
      from: selfJid,
      to: lidJid,
      ack: -1,
    });
    const productionId = message.id as Partial<typeof message.id> & {
      $1?: string;
    };
    delete productionId._serialized;
    productionId.$1 = serializedId;

    let resolveSend: ((value: typeof message) => void) | undefined;
    const client = {
      sendMessage: jest.fn(
        () =>
          new Promise<typeof message>((resolve) => {
            resolveSend = resolve;
          })
      ),
    };

    const sendPromise = (service as any).sendMessageWithConfirmation(
      client,
      lidJid,
      'Auto reply'
    );
    await Promise.resolve();
    await (service as any).handleMessageAck(message, -1);
    if (!resolveSend) {
      throw new Error('sendMessage resolver was not captured');
    }
    resolveSend(message);

    await expect(sendPromise).resolves.toBe(message);
    expect(deliveryConfirmation.markFailed).toHaveBeenCalledWith(serializedId);
    expect(deliveryConfirmation.markSent).toHaveBeenCalledWith(serializedId);
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('releases an accepted auto-reply without waiting for its delivery observer', async () => {
    const { service, deliveryConfirmation } = makeService();
    const serializedId = `true_${lidJid}_accepted-auto-reply`;
    const sentMessage = makeLogMessage({
      serializedId,
      fromMe: true,
      type: 'chat',
      body: 'Auto reply',
      from: selfJid,
      to: lidJid,
    });
    deliveryConfirmation.waitForOutcome.mockReturnValueOnce(
      new Promise(() => undefined)
    );
    const client = {
      sendMessage: jest.fn(async () => sentMessage),
    };

    await expect(
      (service as any).sendMessageWithConfirmation(client, lidJid, 'Auto reply')
    ).resolves.toBe(sentMessage);

    expect(client.sendMessage).toHaveBeenCalledWith(lidJid, 'Auto reply', {
      waitUntilMsgSent: false,
    });
    expect(deliveryConfirmation.waitForOutcome).toHaveBeenCalledWith(
      serializedId,
      20_000
    );
  });

  it('bounds a stuck auto-reply provider call instead of blocking for five minutes', async () => {
    jest.useFakeTimers();
    const consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let rejectProvider: ((error: Error) => void) | undefined;
    const client = {
      sendMessage: jest.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectProvider = reject;
          })
      ),
    };
    const { service } = makeService();

    try {
      const send = (service as any).sendMessageWithConfirmation(
        client,
        lidJid,
        'Auto reply'
      );
      const rejection = expect(send).rejects.toThrow(
        'wwebjs auxiliary provider operation auto_reply_send timed out after 45000ms'
      );

      await jest.advanceTimersByTimeAsync(45_000);
      await rejection;

      rejectProvider?.(new Error('late Puppeteer rejection'));
      await jest.advanceTimersByTimeAsync(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
        expect.objectContaining({
          provider: 'wwebjs',
          operation: 'auto_reply_send',
          timeout_ms: 45_000,
        })
      );
    } finally {
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('replays the 6999715039 ad history in order and creates the decrypted edit as a new incoming message', async () => {
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();
      const connectionScope = (
        service as unknown as {
          activeConnectionScope?: { activatedAt: number };
        }
      ).activeConnectionScope;
      if (!connectionScope) {
        throw new Error('Expected an active WWebJS connection scope');
      }
      connectionScope.activatedAt = Date.now() - 2_000;

      const historyEvents = [
        { seq: 9272, event: 'message_create', args: [makeE2ENotification()] },
        { seq: 9273, event: 'message', args: [makeE2ENotification()] },
        { seq: 9274, event: 'message_create', args: [makeContactInfoCard()] },
        { seq: 9275, event: 'message', args: [makeContactInfoCard()] },
        {
          seq: 9276,
          event: 'message_ciphertext',
          args: [makeAdMessage('ciphertext', '', 'fanout')],
        },
        {
          seq: 9277,
          event: 'unread_count',
          args: [makeUnreadCount(makeAdMessage('ciphertext', '', 'fanout'), 1)],
        },
        {
          seq: 9278,
          event: 'message_create',
          args: [makeAdMessage('ciphertext', '', 'fanout')],
        },
        {
          seq: 9279,
          event: 'message',
          args: [makeAdMessage('ciphertext', '', 'fanout')],
        },
        {
          seq: 9280,
          event: 'message_ciphertext_failed',
          args: [makeAdMessage('ciphertext', '', 'fanout')],
        },
        {
          seq: 9282,
          event: 'chat_state',
          args: [makeChatState()],
        },
        {
          seq: 9325,
          event: 'message_edit',
          args: [makeAdMessage('chat', adBody), adBody, null],
        },
        {
          seq: 9326,
          event: 'message_create',
          args: [makeAdMessage('chat', adBody)],
        },
        {
          seq: 9327,
          event: 'message',
          args: [makeAdMessage('chat', adBody)],
        },
        {
          seq: 2886,
          event: 'message_create',
          args: [makeAdMessage('chat', adBody)],
        },
        {
          seq: 2887,
          event: 'message',
          args: [makeAdMessage('chat', adBody)],
        },
        {
          seq: 2888,
          event: 'message_ack',
          args: [makeAdMessage('chat', adBody), 3],
        },
        { seq: 2889, event: 'message_create', args: [makeE2ENotification()] },
        { seq: 2890, event: 'message', args: [makeE2ENotification()] },
        { seq: 2891, event: 'message_create', args: [makeContactInfoCard()] },
        { seq: 2892, event: 'message', args: [makeContactInfoCard()] },
      ] as const;

      for (const historyEvent of historyEvents) {
        client.emit(historyEvent.event, ...historyEvent.args);
      }
      await flushAsyncHandlers();

      const upsertSends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message'
      );
      const upsertPayloads = upsertSends.map(([, payload]) => payload as any);
      const inboundAdPayloads = upsertPayloads.filter(
        (payload) => payload.message.key.id === adSerializedId
      );

      expect(historyEvents.map((event) => event.seq)).toEqual([
        9272, 9273, 9274, 9275, 9276, 9277, 9278, 9279, 9280, 9282, 9325, 9326,
        9327, 2886, 2887, 2888, 2889, 2890, 2891, 2892,
      ]);
      expect(upsertPayloads.length).toBeGreaterThanOrEqual(2);
      expect(inboundAdPayloads.length).toBeGreaterThanOrEqual(2);
      expect(upsertSends.map((send) => send[2])).toEqual(
        expect.arrayContaining([
          'account-w:worker-w:556999715039@s.whatsapp.net',
        ])
      );
      expect(new Set(upsertSends.map((send) => send[2]))).toEqual(
        new Set(['account-w:worker-w:556999715039@s.whatsapp.net'])
      );
      expect(
        upsertPayloads.some(
          (payload) => payload.type === EMessageType.edit_text
        )
      ).toBe(false);

      const ciphertextPayload = inboundAdPayloads.find(
        (payload) => payload.type === EMessageType.system
      );
      const textPayload = inboundAdPayloads.find(
        (payload) => payload.type === EMessageType.text
      );

      expect(ciphertextPayload).toEqual(
        expect.objectContaining({
          type: EMessageType.system,
          worker_id: 'worker-w',
          account_id: 'account-w',
          has_quoted: false,
        })
      );
      expect(ciphertextPayload?.message.message.conversation).toBe(
        ciphertextFallbackBody
      );
      expect(textPayload).toEqual(
        expect.objectContaining({
          type: EMessageType.text,
          worker_id: 'worker-w',
          account_id: 'account-w',
          has_quoted: false,
        })
      );
      expect(textPayload?.message.key).toEqual(
        expect.objectContaining({
          id: adSerializedId,
          remoteJid: phoneJid,
          remoteJidAlt: lidJid,
          fromMe: false,
        })
      );
      expect(textPayload?.message.message.conversation).toBe(adBody);
      expect(
        textPayload?.message.message.extendedTextMessage.contextInfo
          .externalAdReply
      ).toEqual(
        expect.objectContaining({
          title: 'Pós-Graduação EAD',
          sourceApp: 'facebook',
          sourceId: '120241701325990384',
          sourceUrl: 'https://fb.me/6G4qyAUIJ',
          automatedGreetingMessageShown: true,
        })
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });

  it('creates the ciphertext fallback when only message_ciphertext_failed is received', async () => {
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();
      const connectionScope = (
        service as unknown as {
          activeConnectionScope?: { activatedAt: number };
        }
      ).activeConnectionScope;
      if (!connectionScope) {
        throw new Error('Expected an active WWebJS connection scope');
      }
      connectionScope.activatedAt = Date.now() - 2_000;

      client.emit(
        'message_ciphertext_failed',
        makeAdMessage('ciphertext', '', 'fanout')
      );
      await flushAsyncHandlers();

      const upsertSends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message'
      );
      const upsertPayloads = upsertSends.map(([, payload]) => payload as any);

      expect(upsertPayloads).toHaveLength(1);
      expect(upsertPayloads[0]).toEqual(
        expect.objectContaining({
          type: EMessageType.system,
          worker_id: 'worker-w',
          account_id: 'account-w',
        })
      );
      expect(upsertPayloads[0].message.key.id).toBe(adSerializedId);
      expect(upsertPayloads[0].message.message.conversation).toBe(
        ciphertextFallbackBody
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });

  it('drops historical reaction events even when WWebJS emits them as live events', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();

      client.emit(
        'message_reaction',
        makeReactionEvent({
          reactionId: `false_${lidJid}_reaction-march`,
          parentMsgId: `false_${lidJid}_target-march`,
          timestamp: Math.floor(
            new Date('2026-03-27T13:54:00.000Z').getTime() / 1000
          ),
        })
      );
      await flushMicrotasks();

      expect(
        streamProducerService.send.mock.calls.filter(
          ([topic]) => topic === 'upsert-message'
        )
      ).toHaveLength(0);
    } finally {
      consoleLogSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('publishes one fresh reaction and drops the duplicate event', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();
      await jest.advanceTimersByTimeAsync(1_000);

      const timestamp = Math.floor(Date.now() / 1000);
      const reaction = makeReactionEvent({
        reactionId: `false_${lidJid}_reaction-fresh`,
        parentMsgId: `false_${lidJid}_target-fresh`,
        senderId: phoneJid,
        timestamp,
      });

      client.emit('message_reaction', reaction);
      client.emit('message_reaction', reaction);
      await flushMicrotasks();

      const upsertPayloads = streamProducerService.send.mock.calls
        .filter(([topic]) => topic === 'upsert-message')
        .map(([, payload]) => payload as any);

      expect(upsertPayloads).toHaveLength(1);
      expect(upsertPayloads[0]).toEqual(
        expect.objectContaining({
          type: EMessageType.react,
          worker_id: 'worker-w',
          account_id: 'account-w',
        })
      );
      expect(upsertPayloads[0].message.key).toEqual(
        expect.objectContaining({
          id: `false_${lidJid}_reaction-fresh`,
          remoteJid: lidJid,
          remoteJidAlt: undefined,
          fromMe: false,
          participant: phoneJid,
        })
      );
      expect(upsertPayloads[0].message.messageTimestamp).toBe(timestamp);
      expect(upsertPayloads[0].message.message.reactionMessage).toEqual({
        key: { id: `false_${lidJid}_target-fresh` },
        text: '👍',
      });
    } finally {
      consoleLogSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('recovers WWebJS history from before the current connection without filling live dedupe', async () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();

      const nowSeconds = Math.floor(Date.now() / 1000);
      const serializedId = `false_${lidJid}_history-1`;
      client.emit(
        'message',
        makeLogMessage({
          serializedId,
          fromMe: false,
          type: 'chat',
          body: 'old message',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds - 60,
          isNewMsg: false,
        })
      );

      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();

      let historySends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message-history'
      );
      let liveSends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message'
      );

      expect(historySends).toHaveLength(1);
      expect(liveSends).toHaveLength(0);

      client.emit(
        'message',
        makeLogMessage({
          serializedId,
          fromMe: false,
          type: 'chat',
          body: 'fresh message',
          from: lidJid,
          to: selfJid,
          timestamp: Math.floor(Date.now() / 1000),
          isNewMsg: false,
          recvFresh: true,
        })
      );
      await flushMicrotasks();

      historySends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message-history'
      );
      liveSends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message'
      );

      expect(historySends).toHaveLength(1);
      expect(liveSends).toHaveLength(1);
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('rejects history without a physical timestamp instead of treating it as current', async () => {
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const historyMessage = makeLogMessage({
        serializedId: `false_${lidJid}_history-without-timestamp`,
        fromMe: false,
        type: 'chat',
        body: 'unknown age',
        from: lidJid,
        to: selfJid,
      }) as {
        timestamp?: number;
        _data: { t?: number; timestamp?: number };
      };
      delete historyMessage.timestamp;
      delete historyMessage._data.t;
      delete historyMessage._data.timestamp;

      await expect(
        (
          service as unknown as {
            handleHistoryMessage: (message: unknown) => Promise<boolean>;
          }
        ).handleHistoryMessage(historyMessage)
      ).resolves.toBe(false);

      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(historyMessage.timestamp).toBeUndefined();
      expect(historyMessage._data.t).toBeUndefined();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it('fetches chats from before the current connection and enforces the recovery window', async () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient() as FakeWwebjsClient & {
        getChats: jest.Mock;
      };
      const nowSeconds = Math.floor(Date.now() / 1000);
      const fetchMessages = jest.fn(async () => [
        makeLogMessage({
          serializedId: `false_${lidJid}_history-fetch-too-old`,
          fromMe: false,
          type: 'chat',
          body: 'too old',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds - 6 * 60 * 60 - 60,
          isNewMsg: false,
        }),
        makeLogMessage({
          serializedId: `false_${lidJid}_history-fetch-11`,
          fromMe: false,
          type: 'chat',
          body: '11',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds - 120,
          isNewMsg: false,
        }),
        makeLogMessage({
          serializedId: `false_${lidJid}_history-fetch-12`,
          fromMe: false,
          type: 'chat',
          body: '12',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds - 60,
          isNewMsg: false,
        }),
        makeLogMessage({
          serializedId: `false_${lidJid}_history-fetch-13`,
          fromMe: false,
          type: 'chat',
          body: '13',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds - 30,
          isNewMsg: false,
        }),
      ]);
      client.getChats = jest.fn(async () => [
        {
          id: { _serialized: lidJid },
          isGroup: false,
          timestamp: nowSeconds - 30,
          fetchMessages,
        },
      ]);

      service.bindTo(client as never);
      await service.markConnectionReady();
      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      await flushMicrotasks();

      const historyPayloads = streamProducerService.send.mock.calls
        .filter(([topic]) => topic === 'upsert-message-history')
        .map(([, payload]) => payload as any);
      const liveSends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message'
      );

      expect(fetchMessages).toHaveBeenCalledWith({ limit: 250 });
      expect(historyPayloads).toHaveLength(3);
      expect(liveSends).toHaveLength(0);
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('keeps realtime active when best-effort history fetching times out', async () => {
    jest.useFakeTimers();
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const recovery = jest.fn();

    try {
      const { service } = makeService();
      const client = new FakeWwebjsClient() as FakeWwebjsClient & {
        getChats: jest.Mock;
        sendSeen: jest.Mock;
      };
      client.getChats = jest.fn(() => new Promise<unknown[]>(() => undefined));
      client.sendSeen = jest.fn(async () => undefined);
      service.configureAuxiliaryProviderFailureRecovery(recovery);
      service.bindTo(client as never);
      await service.markConnectionReady();

      await jest.advanceTimersByTimeAsync(15_000);
      await flushMicrotasks();

      expect(client.getChats).toHaveBeenCalledTimes(1);
      expect(recovery).not.toHaveBeenCalled();
      await expect(
        service.markRead([{ remoteJid: '5511999999999@c.us' }])
      ).resolves.toBeUndefined();
      expect(client.sendSeen).toHaveBeenCalledTimes(1);
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('discards startup events received before the connection is marked ready', async () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);

      const nowSeconds = Math.floor(Date.now() / 1000);
      client.emit(
        'message',
        makeLogMessage({
          serializedId: `false_${lidJid}_startup-history`,
          fromMe: false,
          type: 'chat',
          body: 'startup history',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds,
          isNewMsg: true,
        })
      );

      await jest.advanceTimersByTimeAsync(5000);
      await flushMicrotasks();

      expect(streamProducerService.send).not.toHaveBeenCalled();

      await service.markConnectionReady();
      await flushMicrotasks();

      const historySends = streamProducerService.send.mock.calls.filter(
        ([topic]) => topic === 'upsert-message-history'
      );
      expect(historySends).toHaveLength(0);
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('drops timestamp-less historical events after the post-ready grace window', async () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();

      await jest.advanceTimersByTimeAsync(121000);

      const message = makeLogMessage({
        serializedId: `false_${lidJid}_late-missing-timestamp`,
        fromMe: false,
        type: 'chat',
        body: 'missing timestamp outside grace',
        from: lidJid,
        to: selfJid,
        isNewMsg: false,
      }) as any;
      delete message.timestamp;
      delete message._data.t;
      client.emit('message', message);

      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();

      expect(streamProducerService.send).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('buffers only the latest 1000 historical WWebJS messages and flushes them chronologically', async () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleDirSpy = jest
      .spyOn(console, 'dir')
      .mockImplementation(() => undefined);
    const consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    try {
      const { service, streamProducerService } = makeService();
      const client = new FakeWwebjsClient();
      service.bindTo(client as never);
      await service.markConnectionReady();
      await jest.advanceTimersByTimeAsync(1_000);

      const nowSeconds = Math.floor(Date.now() / 1000);
      for (let index = 0; index < 1005; index += 1) {
        client.emit(
          'message',
          makeLogMessage({
            serializedId: `false_${lidJid}_history-${index}`,
            fromMe: false,
            type: 'chat',
            body: `history ${index}`,
            from: lidJid,
            to: selfJid,
            timestamp: nowSeconds,
            isNewMsg: false,
          })
        );
      }

      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();

      const historyPayloads = streamProducerService.send.mock.calls
        .filter(([topic]) => topic === 'upsert-message-history')
        .map(([, payload]) => payload as any);

      expect(historyPayloads).toHaveLength(1000);
      expect(historyPayloads[0].message.key.id).toBe(
        `false_${lidJid}_history-5`
      );
      expect(historyPayloads[historyPayloads.length - 1].message.key.id).toBe(
        `false_${lidJid}_history-1004`
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('uses the shared v3 lifecycle for a call auto-reply before invoking WWebJS', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { service, messageSendIdempotencyService } = makeService();
    const sendToKafkaWithRetry = jest.fn(async () => undefined);
    const sut = service as unknown as {
      sendToKafkaWithRetry: typeof sendToKafkaWithRetry;
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = sendToKafkaWithRetry;
    const client = {
      sendMessage: jest.fn(async () => ({
        id: {
          _serialized: 'true_5511999999999@c.us_call-auto-reply-sent-1',
        },
        timestamp: 1_700_000_000,
      })),
    };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await sut.sendCallAutoReply({
      client,
      callId: 'physical-call-1',
      jid: '5511999999999@c.us',
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(messageSendIdempotencyService.claimOperation).toHaveBeenCalledWith({
      accountId: 'account-w',
      operationType: 'direct',
      operationId: 'call-auto-reply:worker-w:physical-call-1',
      meta: {
        worker_id: 'worker-w',
        call_id: 'physical-call-1',
        source: 'incoming_call_auto_reply',
      },
    });
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      messageSendIdempotencyService.markProviderInvoked.mock
        .invocationCallOrder[0]
    ).toBeLessThan(client.sendMessage.mock.invocationCallOrder[0]);
    expect(client.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      messageSendIdempotencyService.markSucceeded.mock.invocationCallOrder[0]
    );
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'call-auto-reply:worker-w:physical-call-1',
      }),
      expect.objectContaining({
        kafka_key:
          'call_auto_system_true_5511999999999@c.us_call-auto-reply-sent-1',
        call_auto_reply_system_upsert: expect.objectContaining({
          worker_id: 'worker-w',
          account_id: 'account-w',
        }),
      })
    );
  });

  it('does not reject or auto-reply when the WWebJS call callback epoch was replaced', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    balanceWorkerStatusGrpcClientService.resolveIncomingCallAction.mockResolvedValueOnce(
      {
        reject_call: true,
        show_message_on_call: true,
        show_message_text: 'Não atendemos chamadas.',
      }
    );
    const sendToKafkaWithRetry = jest.fn(async () => true);
    const resolvePhotoForCall = jest.fn(async () => undefined);
    const sendCallAutoReply = jest.fn(async () => undefined);
    const isConnectionScopeCurrent = jest.fn(async () => false);
    const sut = service as unknown as {
      sendToKafkaWithRetry: typeof sendToKafkaWithRetry;
      resolvePhotoForCall: typeof resolvePhotoForCall;
      sendCallAutoReply: typeof sendCallAutoReply;
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      handleCall: (call: unknown) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = sendToKafkaWithRetry;
    sut.resolvePhotoForCall = resolvePhotoForCall;
    sut.sendCallAutoReply = sendCallAutoReply;
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const reject = jest.fn(async () => undefined);

    await sut.handleCall({
      id: 'stale-call-wwebjs-1',
      from: '5511999999999@c.us',
      fromMe: false,
      timestamp: 1_700_000_000,
      reject,
    });

    expect(reject).not.toHaveBeenCalled();
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
      sendToKafkaWithRetry: (...args: unknown[]) => Promise<boolean>;
      resolvePhotoForCall: (...args: unknown[]) => Promise<undefined>;
      handleCall: (call: unknown) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = jest.fn(async () => true);
    sut.resolvePhotoForCall = jest.fn(async () => undefined);
    (service as unknown as { currentClient: unknown }).currentClient = {};

    await sut.handleCall({
      id: 'call-resolver-error-1',
      from: '5511999999999@c.us',
      fromMe: false,
      timestamp: 1_700_000_000,
    });

    expect(consoleError).toHaveBeenCalledWith(
      '[wwebjs] resolveIncomingCallAction failed',
      { error_name: 'error', error_code: '57p01' }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });

  it('does not insert an async revocation check between provider_invoked and WWebJS send', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, messageSendIdempotencyService } = makeService();
    const isConnectionScopeCurrent = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sut = service as unknown as {
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const client = {
      sendMessage: jest.fn(async () => ({
        id: { _serialized: 'wwebjs-after-claim-1' },
        timestamp: 1_700_000_000,
      })),
    };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await expect(
      sut.sendCallAutoReply({
        client,
        callId: 'stale-call-wwebjs-after-claim',
        jid: '5511999999999@c.us',
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).resolves.toBeUndefined();

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(isConnectionScopeCurrent).toHaveBeenCalledTimes(2);
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalled();
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalled();
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('does not recover a duplicate WWebJS call auto-reply after its callback epoch is replaced', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    messageSendIdempotencyService.claimOperation.mockResolvedValueOnce({
      status: 'duplicate',
      state: 'succeeded',
      result: {
        call_auto_reply_system_upsert: {
          worker_id: 'worker-w',
          account_id: 'account-w',
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
    const sendToKafkaWithRetry = jest.fn(async () => true);
    const isConnectionScopeCurrent = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sut = service as unknown as {
      sendToKafkaWithRetry: typeof sendToKafkaWithRetry;
      isConnectionScopeCurrent: typeof isConnectionScopeCurrent;
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = sendToKafkaWithRetry;
    sut.isConnectionScopeCurrent = isConnectionScopeCurrent;
    const client = { sendMessage: jest.fn() };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await sut.sendCallAutoReply({
      client,
      callId: 'duplicate-after-reconnect',
      jid: '5511999999999@c.us',
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(sendToKafkaWithRetry).not.toHaveBeenCalled();
  });

  it('recovers a succeeded call auto-reply without sending it to WWebJS again', async () => {
    const { service, messageSendIdempotencyService } = makeService();
    const savedUpsert = {
      worker_id: 'worker-w',
      account_id: 'account-w',
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
      accountId: 'account-w',
      operationType: 'direct',
      operationId: 'call-auto-reply:worker-w:physical-call-1',
      key: 'claim:saved',
      owner: null,
      result: {
        call_auto_reply_system_upsert: savedUpsert,
        kafka_key: 'call_auto_system_saved',
      },
    });
    const sendToKafkaWithRetry = jest.fn(async () => undefined);
    const sut = service as unknown as {
      sendToKafkaWithRetry: typeof sendToKafkaWithRetry;
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = sendToKafkaWithRetry;
    const client = { sendMessage: jest.fn() };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await sut.sendCallAutoReply({
      client,
      callId: 'physical-call-1',
      jid: '5511999999999@c.us',
      text: 'Não atendemos chamadas.',
      photo: null,
    });

    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(sendToKafkaWithRetry).toHaveBeenCalledWith(
      'upsert-message',
      savedUpsert,
      {
        event: 'incoming_call_auto_reply_system_upsert_recovery',
        messageId: 'call_auto_system_saved',
        messageKeyId: 'call_auto_system_saved',
      },
      'call_auto_system_saved'
    );
  });

  it('accepts two distinct calls with identical WWebJS auto-reply text', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { service, messageSendIdempotencyService } = makeService();
    const sut = service as unknown as {
      sendToKafkaWithRetry: jest.Mock<Promise<void>, unknown[]>;
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    sut.sendToKafkaWithRetry = jest.fn(async () => undefined);
    const client = {
      sendMessage: jest
        .fn()
        .mockResolvedValueOnce({
          id: { _serialized: 'true_contact_call-auto-reply-a' },
          timestamp: 1_700_000_001,
        })
        .mockResolvedValueOnce({
          id: { _serialized: 'true_contact_call-auto-reply-b' },
          timestamp: 1_700_000_002,
        }),
    };
    (service as unknown as { currentClient: unknown }).currentClient = client;
    const common = {
      client,
      jid: '5511999999999@c.us',
      text: 'Não atendemos chamadas.',
      photo: null,
    };

    await sut.sendCallAutoReply({ ...common, callId: 'physical-call-a' });
    await sut.sendCallAutoReply({ ...common, callId: 'physical-call-b' });

    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(
      messageSendIdempotencyService.claimOperation.mock.calls.map(
        ([input]) => input.operationId
      )
    ).toEqual([
      'call-auto-reply:worker-w:physical-call-a',
      'call-auto-reply:worker-w:physical-call-b',
    ]);
  });

  it('marks the call auto-reply ambiguous after WWebJS invocation fails', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, messageSendIdempotencyService } = makeService();
    const sut = service as unknown as {
      sendCallAutoReply: (input: {
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    const providerError = new Error('provider uncertain');
    const client = {
      sendMessage: jest.fn(async () => Promise.reject(providerError)),
    };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await expect(
      sut.sendCallAutoReply({
        client,
        callId: 'physical-call-ambiguous',
        jid: '5511999999999@c.us',
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).rejects.toBe(providerError);

    expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'call-auto-reply:worker-w:physical-call-ambiguous',
      }),
      providerError
    );
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markSucceeded).not.toHaveBeenCalled();
  });

  it('keeps a WWebJS call auto-reply fail-closed when provider-invoked CAS applies but its response is lost', async () => {
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
        client: unknown;
        callId: string;
        jid: string;
        text: string;
        photo: string | null;
      }) => Promise<void>;
    };
    const client = { sendMessage: jest.fn() };
    (service as unknown as { currentClient: unknown }).currentClient = client;

    await expect(
      sut.sendCallAutoReply({
        client,
        callId: 'physical-call-release',
        jid: '5511999999999@c.us',
        text: 'Não atendemos chamadas.',
        photo: null,
      })
    ).rejects.toThrow('redis response lost after CAS');

    expect(durableState).toBe('provider_invoked');
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.revertProviderInvocationBeforeStart
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });
});
