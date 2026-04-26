import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  Message: class {},
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
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
  MessageStatusService: class {},
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

type WwebjsIncomingMessageServicePrivate = {
  resolvePhotoForMessage: (
    client: unknown,
    msg: unknown,
    resolvedJids: { remoteJid: string; remoteJidAlt?: string }
  ) => Promise<string | undefined>;
};

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
    const service = new WwebjsIncomingMessageService(
      { send: jest.fn(async () => undefined) } as never,
      { upsertMessage: jest.fn(() => 'upsert-message') } as never,
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

    return {
      service: service as unknown as WwebjsIncomingMessageServicePrivate,
      redis,
      redisStore,
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
});
