import 'reflect-metadata';
import { EMessageType } from '@core/common/enums/EMessageType';

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
  isJidBroadcast: (jid?: string) => jid?.endsWith('@broadcast') ?? false,
  isJidGroup: (jid?: string) => jid?.endsWith('@g.us') ?? false,
  isJidNewsletter: (jid?: string) => jid?.endsWith('@newsletter') ?? false,
  isJidStatusBroadcast: (jid?: string) =>
    jid === 'status@broadcast' || jid?.endsWith('@status') === true,
  isLidUser: (jid?: string) => jid?.endsWith('@lid') ?? false,
  isPnUser: (jid?: string) => jid?.endsWith('@s.whatsapp.net') ?? false,
}));

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
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
      { upsertMessage: jest.fn(() => 'upsert-message') } as never,
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
    jest.clearAllMocks();
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
      'message-key-1'
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
      'message-key-2'
    );
  });
});
