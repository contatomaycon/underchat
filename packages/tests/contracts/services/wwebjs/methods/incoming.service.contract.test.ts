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
    const service = new WwebjsIncomingMessageService(
      streamProducerService as never,
      kafkaServiceQueueService as never,
      redis as never,
      { enrich: jest.fn(async () => undefined) } as never,
      {
        resolveIncomingCallAction: jest.fn(async () => ({
          reject_call: false,
          show_message_on_call: false,
        })),
      } as never,
      {
        waitForOutcome: jest.fn(async () => 'sent'),
        markFailed: jest.fn(),
        markSent: jest.fn(),
      } as never
    );

    return {
      service,
      streamProducerService,
      kafkaServiceQueueService,
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
    isNewMsg?: boolean;
    recvFresh?: boolean;
    ctwaContext?: Record<string, unknown>;
  }) => {
    const id = {
      fromMe: input.fromMe,
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

  const flushAsyncHandlers = async () => {
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const flushMicrotasks = async () => {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }
  };

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
      expect(upsertPayloads).toHaveLength(2);
      expect(inboundAdPayloads).toHaveLength(2);
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

  it('routes historical WWebJS message events to the history topic without filling live dedupe', async () => {
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
      expect(historySends[0][1]).toEqual(
        expect.objectContaining({
          from_history_sync: true,
          type: EMessageType.text,
        })
      );

      client.emit(
        'message_create',
        makeLogMessage({
          serializedId: `true_${lidJid}_history-from-me`,
          fromMe: true,
          type: 'chat',
          body: 'old outgoing message',
          from: selfJid,
          to: lidJid,
          timestamp: nowSeconds - 30,
          isNewMsg: false,
          author: selfJid,
          ack: 3,
        })
      );
      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();

      expect(
        streamProducerService.send.mock.calls.filter(
          ([topic]) => topic === 'upsert-message-history'
        )
      ).toHaveLength(1);

      client.emit(
        'message',
        makeLogMessage({
          serializedId,
          fromMe: false,
          type: 'chat',
          body: 'fresh message',
          from: lidJid,
          to: selfJid,
          timestamp: nowSeconds,
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

  it('buffers only the latest 100 historical WWebJS messages and flushes them chronologically', async () => {
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
      for (let index = 0; index < 105; index += 1) {
        client.emit(
          'message',
          makeLogMessage({
            serializedId: `false_${lidJid}_history-${index}`,
            fromMe: false,
            type: 'chat',
            body: `history ${index}`,
            from: lidJid,
            to: selfJid,
            timestamp: nowSeconds - 200 + index,
            isNewMsg: false,
          })
        );
      }

      await jest.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();

      const historyPayloads = streamProducerService.send.mock.calls
        .filter(([topic]) => topic === 'upsert-message-history')
        .map(([, payload]) => payload as any);

      expect(historyPayloads).toHaveLength(100);
      expect(historyPayloads[0].message.key.id).toBe(
        `false_${lidJid}_history-5`
      );
      expect(historyPayloads[historyPayloads.length - 1].message.key.id).toBe(
        `false_${lidJid}_history-104`
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleDirSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
