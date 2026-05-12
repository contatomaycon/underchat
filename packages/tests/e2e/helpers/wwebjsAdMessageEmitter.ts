import 'reflect-metadata';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const AD_BODY =
  'Olá! Gostaria de saber sobre a Pós-Graduação EAD com um atendimento humanizado!';
const AD_TITLE = 'Pós-Graduação EAD';

interface AdReplay {
  runId: string;
  phoneNumber: string;
  phoneJid: string;
  selfJid: string;
  lidJid: string;
  contactInfoTo: string;
  adMessageId: string;
  adSerializedId: string;
  e2eSerializedId: string;
  contactCardSerializedId: string;
  historySequence: number[];
}

interface KafkaSendCall {
  topic: string;
  payload: unknown;
  key?: string | Buffer;
  delivered: boolean;
  error?: string;
}

type ProducerLike = {
  connect: (
    metadataOptions?: Record<string, unknown>,
    callback?: (error: Error | null) => void
  ) => void;
  disconnect: (callback?: () => void) => void;
  flush: (timeout: number, callback: () => void) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => ProducerLike;
  removeListener: (
    event: string,
    handler: (...args: unknown[]) => void
  ) => ProducerLike;
  poll: () => void;
  produce: (
    topic: string,
    partition: number | null,
    value: Buffer,
    key?: Buffer,
    timestamp?: number,
    opaque?: string
  ) => boolean;
  setPollInterval?: (interval: number) => void;
};

function makeMemoryRedis(): {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<'OK'>;
} {
  const store = new Map<string, string>();

  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
  };
}

function makeLogMessage(
  replay: AdReplay,
  input: {
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
    ctwaContext?: Record<string, unknown>;
  }
): Record<string, unknown> {
  const id = {
    fromMe: input.fromMe,
    remote: replay.lidJid,
    id: input.serializedId.split('_').at(-1),
    _serialized: input.serializedId,
    remoteJid: replay.phoneJid,
    name: null,
  };
  const body = input.body ?? '';

  return {
    _data: {
      id,
      body,
      type: input.type,
      subtype: input.subtype,
      t: input.timestamp ?? 1778190016,
      from: input.from,
      to: input.to,
      ack: input.ack,
      notifyName: input.fromMe ? '' : 'Luh',
      ctwaContext: input.ctwaContext,
    },
    id,
    ack: input.ack,
    hasMedia: false,
    body,
    type: input.type,
    timestamp: input.timestamp ?? 1778190016,
    from: input.from,
    to: input.to,
    author: input.author,
    deviceType: input.fromMe ? 'android' : 'ios',
    fromMe: input.fromMe,
    hasQuotedMsg: false,
    hasReaction: false,
    getContact: async () => ({
      pushname: 'Luh',
      getProfilePicUrl: async () => undefined,
    }),
    getChat: async () => ({
      name: `+${replay.phoneNumber}`,
    }),
    getQuotedMessage: async () => undefined,
  };
}

function makeAdCtwaContext(): Record<string, unknown> {
  return {
    conversionSource: 'FB_Ads',
    ctwaSignals: 'all,all',
    sourceUrl: 'https://fb.me/6G4qyAUIJ',
    description:
      'Você já concluiu a graduação e quer ir além, mas sem enrolação?',
    title: AD_TITLE,
    mediaType: 1,
    sourceApp: 'facebook',
    greetingMessageBody: 'Olá! Diga como podemos ajudar você.',
    automatedGreetingMessageShown: true,
    sourceId: '120241701325990384',
    originalImageUrl: 'https://www.facebook.com/ads/image/?d=e2e',
  };
}

function makeAdMessage(
  replay: AdReplay,
  type: string,
  body = '',
  subtype?: string
): Record<string, unknown> {
  return makeLogMessage(replay, {
    serializedId: replay.adSerializedId,
    fromMe: false,
    type,
    body,
    subtype,
    from: replay.lidJid,
    to: replay.selfJid,
    ack: 1,
    ctwaContext: body ? makeAdCtwaContext() : undefined,
  });
}

function makeUnreadCount(
  replay: AdReplay,
  lastMessage: Record<string, unknown>,
  unreadCount: number
): Record<string, unknown> {
  return {
    id: {
      server: 'lid',
      user: replay.lidJid.replace('@lid', ''),
      _serialized: replay.lidJid,
    },
    name: `+${replay.phoneNumber}`,
    isGroup: false,
    unreadCount,
    timestamp: 1778190016,
    pinned: false,
    isMuted: false,
    muteExpiration: 0,
    lastMessage,
  };
}

function makeChatState(replay: AdReplay): Record<string, unknown> {
  return {
    chatId: replay.lidJid,
    userId: replay.lidJid,
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
  };
}

function makeE2ENotification(replay: AdReplay): Record<string, unknown> {
  return makeLogMessage(replay, {
    serializedId: replay.e2eSerializedId,
    fromMe: false,
    type: 'e2e_notification',
    subtype: 'encrypt',
    from: replay.lidJid,
    to: replay.contactInfoTo,
  });
}

function makeContactInfoCard(replay: AdReplay): Record<string, unknown> {
  return makeLogMessage(replay, {
    serializedId: replay.contactCardSerializedId,
    fromMe: false,
    type: 'notification_template',
    subtype: 'contact_info_card',
    from: replay.lidJid,
    to: replay.contactInfoTo,
  });
}

function buildHistoryEvents(replay: AdReplay): Array<{
  seq: number;
  event: string;
  args: unknown[];
}> {
  return [
    { seq: 9272, event: 'message_create', args: [makeE2ENotification(replay)] },
    { seq: 9273, event: 'message', args: [makeE2ENotification(replay)] },
    {
      seq: 9274,
      event: 'message_create',
      args: [makeContactInfoCard(replay)],
    },
    { seq: 9275, event: 'message', args: [makeContactInfoCard(replay)] },
    {
      seq: 9276,
      event: 'message_ciphertext',
      args: [makeAdMessage(replay, 'ciphertext', '', 'fanout')],
    },
    {
      seq: 9277,
      event: 'unread_count',
      args: [
        makeUnreadCount(
          replay,
          makeAdMessage(replay, 'ciphertext', '', 'fanout'),
          1
        ),
      ],
    },
    {
      seq: 9278,
      event: 'message_create',
      args: [makeAdMessage(replay, 'ciphertext', '', 'fanout')],
    },
    {
      seq: 9279,
      event: 'message',
      args: [makeAdMessage(replay, 'ciphertext', '', 'fanout')],
    },
    {
      seq: 9280,
      event: 'message_ciphertext_failed',
      args: [makeAdMessage(replay, 'ciphertext', '', 'fanout')],
    },
    {
      seq: 9282,
      event: 'chat_state',
      args: [makeChatState(replay)],
    },
    {
      seq: 9325,
      event: 'message_edit',
      args: [makeAdMessage(replay, 'chat', AD_BODY), AD_BODY, null],
    },
    {
      seq: 9326,
      event: 'message_create',
      args: [makeAdMessage(replay, 'chat', AD_BODY)],
    },
    {
      seq: 9327,
      event: 'message',
      args: [makeAdMessage(replay, 'chat', AD_BODY)],
    },
    {
      seq: 2886,
      event: 'message_create',
      args: [makeAdMessage(replay, 'chat', AD_BODY)],
    },
    {
      seq: 2887,
      event: 'message',
      args: [makeAdMessage(replay, 'chat', AD_BODY)],
    },
    {
      seq: 2888,
      event: 'message_ack',
      args: [makeAdMessage(replay, 'chat', AD_BODY), 3],
    },
    { seq: 2889, event: 'message_create', args: [makeE2ENotification(replay)] },
    { seq: 2890, event: 'message', args: [makeE2ENotification(replay)] },
    {
      seq: 2891,
      event: 'message_create',
      args: [makeContactInfoCard(replay)],
    },
    { seq: 2892, event: 'message', args: [makeContactInfoCard(replay)] },
  ];
}

function assertHistorySequence(
  events: Array<{ seq: number }>,
  expected: number[]
): void {
  const actual = events.map((event) => event.seq);
  if (actual.length !== expected.length) {
    throw new Error(`Unexpected history length: ${actual.join(',')}`);
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `Unexpected history sequence. Expected ${expected.join(
          ','
        )}, received ${actual.join(',')}`
      );
    }
  }
}

function serializeKafkaPayload(payload: unknown): Buffer {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (typeof payload === 'string') {
    return Buffer.from(payload, 'utf-8');
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload);
  }

  return Buffer.from(JSON.stringify(payload), 'utf-8');
}

function getPayloadMessageKeyId(payload: unknown): string | undefined {
  const value = payload as {
    message?: {
      key?: {
        id?: unknown;
      };
    };
  };

  return typeof value?.message?.key?.id === 'string'
    ? value.message.key.id
    : undefined;
}

function getPayloadMessageType(payload: unknown): string | undefined {
  const value = payload as {
    type?: unknown;
  };

  return typeof value?.type === 'string' ? value.type : undefined;
}

function toOptionalError(value: unknown): Error | null {
  if (!value) {
    return null;
  }

  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}

function readReplay(): AdReplay {
  const raw = process.env.E2E_WWEBJS_AD_REPLAY;
  if (!raw) {
    throw new Error('Missing E2E_WWEBJS_AD_REPLAY payload.');
  }

  return JSON.parse(raw) as AdReplay;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

function buildKafkaProducerConfig(): Record<string, string | number | boolean> {
  const protocol = requiredEnv('SECURITY_PROTOCOL').toLowerCase();
  const config: Record<string, string | number | boolean> = {
    'metadata.broker.list': requiredEnv('KAFKA_BROKER'),
    'client.id': `e2e-wwebjs-ad-${process.pid}-${Date.now()}`,
    'security.protocol': protocol,
    'socket.timeout.ms': 10_000,
    'socket.keepalive.enable': true,
    'api.version.request': true,
    'message.timeout.ms': 30_000,
    dr_cb: true,
  };

  if (protocol !== 'plaintext') {
    config['sasl.mechanism'] = requiredEnv('SASL_MECHANISM').toUpperCase();
    config['sasl.username'] = requiredEnv('KAFKA_USERNAME');
    config['sasl.password'] = requiredEnv('KAFKA_PASSWORD');
  }

  if (protocol === 'sasl_ssl' || protocol === 'ssl') {
    config['enable.ssl.certificate.verification'] = false;
  }

  return config;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

async function flushAsyncHandlers(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function silenceServiceConsoleNoise(): void {
  console.log = () => undefined;
  console.dir = () => undefined;
  console.warn = () => undefined;
}

class RecordingKafkaProducer {
  private readonly calls: KafkaSendCall[] = [];
  private producer: ProducerLike | null = null;
  private connectPromise: Promise<ProducerLike> | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(private readonly deliveryTimeoutMs: number) {}

  deliveredCalls(): KafkaSendCall[] {
    return this.calls.filter((call) => call.delivered);
  }

  async send(
    topic: string,
    payload: unknown,
    key?: string | Buffer
  ): Promise<void> {
    const call: KafkaSendCall = {
      topic,
      payload,
      key,
      delivered: false,
    };
    this.calls.push(call);

    try {
      const value = serializeKafkaPayload(payload);
      const keyBuffer = key
        ? Buffer.isBuffer(key)
          ? key
          : Buffer.from(key, 'utf-8')
        : undefined;
      await this.produce(topic, value, keyBuffer);
      call.delivered = true;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async waitFor(
    predicate: (calls: KafkaSendCall[]) => boolean,
    timeoutMs: number
  ): Promise<KafkaSendCall[]> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (predicate(this.calls)) {
        return this.calls;
      }

      await delay(100);
    }

    throw new Error(
      `Kafka send condition was not met in ${timeoutMs}ms. Calls: ${JSON.stringify(
        this.calls.map((call) => ({
          topic: call.topic,
          delivered: call.delivered,
          error: call.error,
          messageKeyId: getPayloadMessageKeyId(call.payload),
        })),
        null,
        2
      )}`
    );
  }

  async close(): Promise<void> {
    const producer = this.producer;
    if (!producer) {
      return;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await new Promise<void>((resolve) => {
      producer.flush(5_000, () => {
        producer.disconnect(resolve);
      });
    });

    this.producer = null;
    this.connectPromise = null;
  }

  private async produce(
    topic: string,
    value: Buffer,
    key?: Buffer
  ): Promise<void> {
    const producer = await this.connect();

    await new Promise<void>((resolve, reject) => {
      const opaque = `e2e-${Date.now()}-${Math.random()}`;
      let timeout: NodeJS.Timeout | null = null;
      let onDeliveryReport: ((...args: unknown[]) => void) | null = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }

        if (onDeliveryReport) {
          producer.removeListener('delivery-report', onDeliveryReport);
        }
      };

      onDeliveryReport = (...args: unknown[]) => {
        const error = toOptionalError(args[0]);
        const report = args[1] as { opaque?: string } | null;

        if (report?.opaque !== opaque) {
          return;
        }

        cleanup();

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Kafka delivery timeout for topic ${topic} after ${this.deliveryTimeoutMs}ms`
          )
        );
      }, this.deliveryTimeoutMs);

      producer.on('delivery-report', onDeliveryReport);

      try {
        const accepted = producer.produce(
          topic,
          null,
          value,
          key,
          Date.now(),
          opaque
        );
        producer.poll();

        if (accepted === false) {
          cleanup();
          reject(new Error(`Kafka producer rejected topic ${topic}.`));
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private async connect(): Promise<ProducerLike> {
    if (this.producer) {
      return this.producer;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<ProducerLike>((resolve, reject) => {
      const rdkafka = require('node-rdkafka') as {
        Producer: new (
          config: Record<string, string | number | boolean>,
          topicConfig: Record<string, unknown>
        ) => ProducerLike;
      };
      const producer = new rdkafka.Producer(buildKafkaProducerConfig(), {});
      let timeout: NodeJS.Timeout | null = null;
      let onReady: (() => void) | null = null;
      let onError: ((error: unknown) => void) | null = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }

        if (onReady) {
          producer.removeListener('ready', onReady);
        }

        if (onError) {
          producer.removeListener('event.error', onError);
        }
      };

      onReady = () => {
        cleanup();
        this.producer = producer;

        if (producer.setPollInterval) {
          producer.setPollInterval(10);
        } else {
          this.pollInterval = setInterval(() => producer.poll(), 10);
          this.pollInterval.unref?.();
        }

        resolve(producer);
      };

      onError = (error: unknown) => {
        cleanup();
        reject(toOptionalError(error) ?? new Error(String(error)));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Kafka producer connection timeout.'));
      }, 10_000);

      producer.on('ready', onReady);
      producer.on('event.error', onError);
      producer.connect({}, (error) => {
        if (!error) {
          return;
        }

        cleanup();
        reject(error);
      });
    });

    return this.connectPromise;
  }
}

class FakeWwebjsClient {
  readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly info: { wid: { _serialized: string } };

  constructor(private readonly replay: AdReplay) {
    this.info = {
      wid: {
        _serialized: replay.selfJid,
      },
    };
  }

  getProfilePicUrl = async () => undefined;

  getContactById = async () => ({
    isMe: false,
    pushname: 'Luh',
    getProfilePicUrl: async () => undefined,
  });

  getContactLidAndPhone = async () => [
    {
      lid: this.replay.lidJid,
      pn: this.replay.phoneJid,
    },
  ];

  onWhatsApp = async () => [
    {
      exists: true,
      jid: this.replay.phoneJid,
    },
  ];

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

async function main(): Promise<void> {
  silenceServiceConsoleNoise();

  const replay = readReplay();
  const deliveryTimeoutMs = readPositiveIntegerEnv(
    'E2E_WWEBJS_AD_KAFKA_TIMEOUT_MS',
    30_000
  );
  const producer = new RecordingKafkaProducer(deliveryTimeoutMs);

  try {
    const { WwebjsIncomingMessageService } =
      await import('@core/services/wwebjs/methods/incoming.service');

    const service = new WwebjsIncomingMessageService(
      producer as never,
      {
        upsertMessage: () => 'upsert.message',
        updateMessageStatus: () => 'update.message.status',
      } as never,
      makeMemoryRedis() as never,
      { enrich: async () => undefined } as never,
      {
        resolveIncomingCallAction: async () => ({
          reject_call: false,
          show_message_on_call: false,
        }),
      } as never,
      {
        waitForOutcome: async () => 'sent',
        markFailed: () => undefined,
        markSent: () => undefined,
      } as never
    );
    const client = new FakeWwebjsClient(replay);
    service.bindTo(client as never);

    const historyEvents = buildHistoryEvents(replay);
    assertHistorySequence(historyEvents, replay.historySequence);

    for (const historyEvent of historyEvents) {
      client.emit(historyEvent.event, ...historyEvent.args);
    }

    await flushAsyncHandlers();
    await producer.waitFor((calls) => {
      const deliveredAdTypes = calls
        .filter(
          (call) =>
            call.delivered &&
            call.topic === 'upsert.message' &&
            getPayloadMessageKeyId(call.payload) === replay.adSerializedId
        )
        .map((call) => getPayloadMessageType(call.payload));

      return (
        deliveredAdTypes.includes('system') && deliveredAdTypes.includes('text')
      );
    }, deliveryTimeoutMs);

    process.stdout.write(
      JSON.stringify({
        sequence: replay.historySequence,
        phoneNumber: replay.phoneNumber,
        lidJid: replay.lidJid,
        adSerializedId: replay.adSerializedId,
        deliveredTopics: producer.deliveredCalls().map((call) => call.topic),
      })
    );
  } finally {
    await producer.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.exit(1);
});
