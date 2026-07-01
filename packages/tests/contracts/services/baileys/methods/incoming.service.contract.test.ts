import 'reflect-metadata';
import { EMessageType } from '@core/common/enums/EMessageType';

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

describe('BaileysIncomingMessageService', () => {
  const createdServices: BaileysIncomingMessageService[] = [];

  const makeService = () => {
    const redisStore = new Map<string, string>();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    const service = new BaileysIncomingMessageService(
      streamProducerService as never,
      {
        upsertMessage: jest.fn(() => 'upsert-message'),
        upsertMessageHistory: jest.fn(() => 'upsert-message-history'),
      } as never,
      { publishSub: jest.fn(async () => undefined) } as never,
      redis as never,
      { enrich: jest.fn(async () => undefined) } as never,
      {
        resolveIncomingCallAction: jest.fn(async () => ({
          reject_call: false,
          show_message_on_call: false,
        })),
      } as never,
      { waitForOutcome: jest.fn(async () => 'sent') } as never
    );
    createdServices.push(service);

    return {
      service,
      redis,
      redisStore,
      streamProducerService,
    };
  };

  afterEach(async () => {
    await Promise.all(
      createdServices.splice(0).map((service) => service.destroy())
    );
    jest.restoreAllMocks();
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
            id: expect.stringMatching(/^edit_message-1_/),
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

  it('selects the latest 100 historical messages globally and returns them chronologically', () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    try {
      const { service } = makeService();
      const sut = service as unknown as {
        selectLatestHistoryMessages: (messages: unknown[]) => Array<{
          key?: { id?: string };
        }>;
      };
      const nowSeconds = Math.floor(Date.now() / 1000);

      const messages = Array.from({ length: 105 }, (_, index) => ({
        key: {
          id: `history-${index}`,
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: nowSeconds - 200 + index,
        message: { conversation: `history ${index}` },
      }));

      const selected = sut.selectLatestHistoryMessages(messages);

      expect(selected).toHaveLength(100);
      expect(selected[0].key?.id).toBe('history-5');
      expect(selected[selected.length - 1].key?.id).toBe('history-104');
    } finally {
      jest.useRealTimers();
    }
  });

  it('filters non-receivable Baileys history before enforcing the 100 message limit', () => {
    jest.useFakeTimers({
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    try {
      const { service } = makeService();
      const sut = service as unknown as {
        selectLatestHistoryMessages: (messages: unknown[]) => Array<{
          key?: { id?: string };
        }>;
      };
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
        messageTimestamp: nowSeconds - 61 * 60,
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
});
