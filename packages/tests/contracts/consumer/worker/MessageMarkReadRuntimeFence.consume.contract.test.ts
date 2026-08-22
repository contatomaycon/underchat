import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysWorkerId: 'worker-shared',
  },
  wwebjsEnvironment: {
    wwebjsWorkerId: 'worker-shared',
  },
}));

jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));

jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

const mockStatusKafkaKey = jest.fn(
  (accountId: string, messageId: string, workerId?: string) =>
    `${accountId}:${workerId ?? 'unknown-worker'}:${messageId}`
);

jest.mock('@core/services/messageStatus.service', () => ({
  MessageStatusService: {
    statusKafkaKey: (...args: [string, string, string?]) =>
      mockStatusKafkaKey(...args),
  },
}));

import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { MessageMarkReadConsume } from '@core/consumer/worker/MessageMarkRead.consume';
import { MessageMarkReadWwebjsConsume } from '@core/consumer/worker/MessageMarkReadWwebjs.consume';

const baseScope = {
  worker_id: 'worker-shared',
  runtime_generation: 23,
  connection_epoch: 'connection-epoch-23',
  activated_at: 1_752_670_800_000,
};

const payload = {
  account_id: 'account-1',
  worker_id: 'worker-shared',
  keys: [
    {
      id: 'physical-message-1',
      remoteJid: '5511999999999@s.whatsapp.net',
      fromMe: false,
    },
  ],
};

function makeContext(assertActive: () => void = jest.fn(() => undefined)) {
  return {
    topic: 'mark.message.read',
    groupId: 'group-underchat-mark-read-worker-shared',
    message: {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 4,
    },
    partition: 0,
    offset: 4,
    kafkaKey: null,
    entityKey: 'account-1:worker-shared',
    attempt: 1,
    payload,
    isActive: () => true,
    assertActive,
  };
}

function makeConsumer(
  Consumer: typeof MessageMarkReadConsume | typeof MessageMarkReadWwebjsConsume,
  provider: 'baileys' | 'wwebjs',
  scopes: Array<typeof baseScope & { source_provider: 'baileys' | 'wwebjs' }>
) {
  const consumer = Object.create(Consumer.prototype) as any;
  const captureActiveConnectionScope = jest.fn(async () => scopes.shift());
  const markRead = jest.fn(async () => undefined);
  const incoming = {
    captureActiveConnectionScope,
    markRead,
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };

  consumer.redis = { get: jest.fn(async () => 'true') };
  consumer.kafkaServiceQueueService = {
    updateMessageStatus: jest.fn(() => 'update.message.status'),
  };
  consumer.streamProducerService = streamProducerService;
  consumer.baileysIncomingMessageService = incoming;
  consumer.wwebjsIncomingMessageService = incoming;

  return {
    consumer,
    incoming,
    provider,
    streamProducerService,
  };
}

describe('mark-read runtime and assignment fencing', () => {
  it.each([
    [MessageMarkReadConsume, 'baileys' as const],
    [MessageMarkReadWwebjsConsume, 'wwebjs' as const],
  ])(
    'publishes a worker-scoped, provider-neutral status identity for %s',
    async (Consumer, provider) => {
      const scope = { ...baseScope, source_provider: provider };
      const { consumer, incoming, streamProducerService } = makeConsumer(
        Consumer,
        provider,
        [{ ...scope }, { ...scope }, { ...scope }]
      );
      const context = makeContext();

      await consumer.processMarkRead(payload, context);

      expect(incoming.markRead).toHaveBeenCalledTimes(1);
      expect(mockStatusKafkaKey).toHaveBeenCalledWith(
        'account-1',
        'physical-message-1',
        'worker-shared'
      );
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'update.message.status',
        expect.objectContaining({
          event_id: expect.stringMatching(/^message_status_v1_/),
          account_id: 'account-1',
          worker_id: 'worker-shared',
          source_provider: provider,
          runtime_generation: 23,
          connection_epoch: 'connection-epoch-23',
          message_id: 'physical-message-1',
          patch: { is_seen: true },
        }),
        'account-1:worker-shared:physical-message-1',
        undefined,
        context.assertActive
      );
    }
  );

  it('propagates Kafka assignment revocation before the external call', async () => {
    const scope = { ...baseScope, source_provider: 'baileys' as const };
    const { consumer, incoming, streamProducerService } = makeConsumer(
      MessageMarkReadConsume,
      'baileys',
      [{ ...scope }]
    );
    const revoked = new KafkaConsumerDispatchRevokedError();
    const context = makeContext(
      jest.fn(() => {
        throw revoked;
      })
    );

    await expect(consumer.processMarkRead(payload, context)).rejects.toBe(
      revoked
    );
    expect(incoming.markRead).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('discards the status publication when the connection changes after mark-read', async () => {
    const scope = { ...baseScope, source_provider: 'wwebjs' as const };
    const nextScope = {
      ...scope,
      connection_epoch: 'connection-epoch-24',
    };
    const { consumer, incoming, streamProducerService } = makeConsumer(
      MessageMarkReadWwebjsConsume,
      'wwebjs',
      [{ ...scope }, { ...scope }, nextScope]
    );

    await consumer.processMarkRead(payload, makeContext());

    expect(incoming.markRead).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('does not swallow assignment revocation while checking the post-call scope', async () => {
    const scope = { ...baseScope, source_provider: 'baileys' as const };
    const nextScope = {
      ...scope,
      connection_epoch: 'connection-epoch-24',
    };
    const { consumer, incoming, streamProducerService } = makeConsumer(
      MessageMarkReadConsume,
      'baileys',
      [{ ...scope }, { ...scope }, nextScope]
    );
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest
      .fn<void, []>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw revoked;
      });

    await expect(
      consumer.processMarkRead(payload, makeContext(assertActive))
    ).rejects.toBe(revoked);

    expect(incoming.markRead).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });
});
