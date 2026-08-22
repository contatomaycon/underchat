import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/, '@s.whatsapp.net')
  ),
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-wwebjs',
    wwebjsWorkerId: 'worker-wwebjs',
  },
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

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';

function makeOfficialCtaMessage(): IChatMessage {
  return {
    message_id: 'internal-message-1',
    chat_id: 'chat-1',
    message_key: {
      remote_jid: '5511999999999@c.us',
      from_me: true,
      is_view_once: false,
    },
    type_user: ETypeUserChat.bot,
    account: { id: 'account-wwebjs', name: 'Account' },
    worker: { id: 'worker-wwebjs', name: 'WWebJS' },
    user: null,
    phone: '5511999999999',
    summary: {
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: true,
    },
    date: '2026-07-02T13:46:09.000Z',
    content: {
      type: EMessageType.official_interactive,
      message: 'Clique no link para abrir',
      official: {
        provider: 'meta_whatsapp',
        type: 'interactive',
        display: {
          kind: 'cta_url',
          raw_type: 'cta_url',
          body: 'Clique no link para abrir',
          action_label: 'Underchat',
          actions: [
            {
              type: 'cta_url',
              title: 'Underchat',
              url: 'https://underchat.com.br/',
            },
          ],
        },
      },
    },
  };
}

function makeConsumer() {
  const sendResult = {
    key: {
      id: 'wwebjs-message-1',
      remote_jid: '5511999999999@c.us',
      from_me: true,
    },
  };
  const wwebjsMessageTextService = {
    sendText: jest.fn(
      async (
        _jid: string,
        _text: string,
        _options?: unknown,
        beforeProviderInvoke?: () => Promise<void>
      ) => {
        await beforeProviderInvoke?.();
        return sendResult;
      }
    ),
    sendTextQuoted: jest.fn(
      async (
        _jid: string,
        _text: string,
        _quoted: unknown,
        _options?: unknown,
        beforeProviderInvoke?: () => Promise<void>
      ) => {
        await beforeProviderInvoke?.();
        return sendResult;
      }
    ),
  };
  const wwebjsMessageEditDeleteService = {
    forwardMessage: jest.fn(),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    updateMessage: jest.fn(() => 'update.message'),
    updateMessageStatus: jest.fn(() => 'update.message.status'),
    updateProfileStatusExternalId: jest.fn(
      () => 'update.profile.status.external-id'
    ),
  };
  const acquiredClaim = {
    status: 'acquired' as const,
    state: 'reserved' as const,
    accountId: 'account-wwebjs',
    operationType: 'direct' as const,
    operationId: 'command-operation',
    key: 'command-idempotency-key',
    owner: 'command-owner-token',
    result: null,
  };
  const messageSendIdempotencyService = {
    claimOperation: jest.fn(async () => acquiredClaim),
    markProviderInvoked: jest.fn(async () => 'transitioned'),
    markSucceeded: jest.fn(async () => 'transitioned'),
    markAmbiguous: jest.fn(async () => 'transitioned'),
    releaseReservation: jest.fn(async () => 'transitioned'),
  };
  const invokeBoundary = async (
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<void> => {
    await beforeProviderInvoke?.();
  };
  const wwebjsMessageStatusStoriesService = {
    sendStatusText: jest.fn(
      async (_jid: string, _text: string, boundary?: () => Promise<void>) => {
        await invokeBoundary(boundary);
        return { key: { id: 'status-external-id' } };
      }
    ),
    sendStatusImage: jest.fn(
      async (
        _jid: string,
        _media: unknown,
        _options: unknown,
        boundary?: () => Promise<void>
      ) => {
        await invokeBoundary(boundary);
        return { key: { id: 'status-external-id' } };
      }
    ),
    sendStatusVideo: jest.fn(),
    sendStatusAudio: jest.fn(),
    deleteStatus: jest.fn(),
  };
  const wwebjsProfileService = {
    updateProfileName: jest.fn(
      async (_name: string, boundary?: () => Promise<void>) =>
        invokeBoundary(boundary)
    ),
    updateProfileStatus: jest.fn(
      async (_status: string, boundary?: () => Promise<void>) =>
        invokeBoundary(boundary)
    ),
    updateProfilePicture: jest.fn(
      async (_url: string, boundary?: () => Promise<void>) =>
        invokeBoundary(boundary)
    ),
    removeProfilePicture: jest.fn(async (boundary?: () => Promise<void>) =>
      invokeBoundary(boundary)
    ),
  };
  const connectionScope = {
    worker_id: 'worker-wwebjs',
    runtime_generation: 7,
    connection_epoch: 'connection-wwebjs-7',
    source_provider: 'wwebjs' as const,
    activated_at: Date.now(),
  };
  const wwebjsIncomingMessageService = {
    captureActiveConnectionScope: jest.fn(async () => connectionScope),
  };
  const consumer = new MessageSendWwebjsConsume(
    wwebjsMessageTextService as never,
    {} as never,
    {} as never,
    wwebjsMessageEditDeleteService as never,
    {} as never,
    wwebjsMessageStatusStoriesService as never,
    wwebjsProfileService as never,
    wwebjsIncomingMessageService as never,
    {} as never,
    streamProducerService as never,
    kafkaServiceQueueService as never,
    {} as never,
    messageSendIdempotencyService as never
  );

  return {
    consumer,
    kafkaServiceQueueService,
    sendResult,
    streamProducerService,
    wwebjsMessageEditDeleteService,
    wwebjsMessageTextService,
    wwebjsMessageStatusStoriesService,
    wwebjsProfileService,
    wwebjsIncomingMessageService,
    messageSendIdempotencyService,
  };
}

function makeMessageEnvelope(payload: IChatMessage) {
  return {
    sourceTopic: 'worker.worker-wwebjs.send.message',
    partition: 0,
    offset: 40,
    kafkaKey: payload.message_id,
    payload,
    queueKey: `chat:${payload.account.id}:${payload.chat_id}`,
    chatId: payload.chat_id,
    assertDispatchActive: jest.fn(() => undefined),
  };
}

describe('MessageSendWwebjsConsume', () => {
  it('sends official CTA URL as WWebJS text fallback while preserving official display metadata', async () => {
    const {
      consumer,
      sendResult,
      streamProducerService,
      wwebjsMessageTextService,
      messageSendIdempotencyService,
    } = makeConsumer();
    const message = makeOfficialCtaMessage();

    await (consumer as any).processPayload(
      message,
      makeMessageEnvelope(message)
    );

    expect(wwebjsMessageTextService.sendText).toHaveBeenCalledWith(
      '5511999999999@c.us',
      'Clique no link para abrir',
      { extra: undefined },
      expect.any(Function)
    );
    expect(wwebjsMessageTextService.sendTextQuoted).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message',
      expect.objectContaining({
        event_id: expect.stringMatching(/^message_update_v1_/),
        worker_id: 'worker-wwebjs',
        source_provider: 'wwebjs',
        runtime_generation: 7,
        connection_epoch: 'connection-wwebjs-7',
        message: sendResult,
        data: expect.objectContaining({
          message_id: 'internal-message-1',
          content: expect.objectContaining({
            type: EMessageType.official_interactive,
            official: expect.objectContaining({
              display: expect.objectContaining({
                kind: 'cta_url',
                body: 'Clique no link para abrir',
                action_label: 'Underchat',
                actions: [
                  expect.objectContaining({
                    title: 'Underchat',
                    url: 'https://underchat.com.br/',
                  }),
                ],
              }),
            }),
          }),
        }),
      }),
      'account-wwebjs:worker-wwebjs:internal-message-1',
      undefined,
      expect.any(Function)
    );
  });

  it('does not call the fallback after a native forward becomes ambiguous', async () => {
    const {
      consumer,
      messageSendIdempotencyService,
      wwebjsMessageEditDeleteService,
      wwebjsMessageTextService,
    } = makeConsumer();
    const message = makeOfficialCtaMessage();
    message.content = {
      type: EMessageType.text,
      message: 'fallback must not be sent',
      forward: {
        source_message_id: 'source-internal-1',
        source_chat_id: 'source-chat-1',
        source_type: EMessageType.text,
        source_message_key: {
          id: 'source-stanza-1',
          remote_jid: '5511777777777@c.us',
          from_me: true,
          is_view_once: false,
        },
      },
    };
    wwebjsMessageEditDeleteService.forwardMessage.mockImplementation(
      async (
        _jid: string,
        _key: unknown,
        beforeProviderInvoke: () => Promise<void>
      ) => {
        await beforeProviderInvoke();
        throw new Error('native forward timeout');
      }
    );

    await expect(
      (consumer as any).processPayload(message, makeMessageEnvelope(message))
    ).resolves.toBeUndefined();

    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-wwebjs',
        operationType: 'direct',
      }),
      expect.objectContaining({ message: 'native forward timeout' }),
      expect.objectContaining({
        schema_version: 'message_send_ambiguous_terminal_v1',
        provider: 'wwebjs',
        status_update: expect.objectContaining({
          ambiguous: true,
        }),
      })
    );
    expect(wwebjsMessageTextService.sendText).not.toHaveBeenCalled();
    expect(wwebjsMessageTextService.sendTextQuoted).not.toHaveBeenCalled();
  });

  it('releases a status command when media preflight fails before the provider boundary', async () => {
    const {
      consumer,
      messageSendIdempotencyService,
      wwebjsMessageStatusStoriesService,
    } = makeConsumer();
    const payload = {
      worker_id: 'worker-wwebjs',
      account_id: 'account-wwebjs',
      worker_profile_status_id: 'profile-status-1',
      worker_profile_status_type_id: EWorkerProfileStatusType.image,
      value: 'https://cdn.example/status.jpg|caption',
      is_permanent: false,
    };
    const envelope = {
      sourceTopic: 'worker.worker-wwebjs.send.message',
      partition: 0,
      offset: 41,
      kafkaKey: null,
      payload,
      queueKey: 'profile_status:profile-status-1',
      chatId: null,
      assertDispatchActive: () => undefined,
    };
    wwebjsMessageStatusStoriesService.sendStatusImage.mockRejectedValueOnce(
      new Error('status media download failed')
    );

    await expect(
      (consumer as any).processPayload(payload, envelope)
    ).rejects.toMatchObject({
      name: 'MessageUpdatePublishFailedError',
      originalCause: expect.objectContaining({
        message: 'status media download failed',
      }),
    });

    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.releaseReservation
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('does not republish a status external id after Kafka dispatch revocation', async () => {
    const { consumer, messageSendIdempotencyService, streamProducerService } =
      makeConsumer();
    const payload = {
      worker_id: 'worker-wwebjs',
      account_id: 'account-wwebjs',
      worker_profile_status_id: 'profile-status-fenced',
      worker_profile_status_type_id: EWorkerProfileStatusType.text,
      value: 'Status fenced',
      is_permanent: false,
    };
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertDispatchActive = jest
      .fn<void, []>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw revoked;
      });
    const envelope = {
      sourceTopic: 'worker.worker-wwebjs.send.message',
      partition: 0,
      offset: 43,
      kafkaKey: null,
      payload,
      queueKey: 'profile_status:profile-status-fenced',
      chatId: null,
      assertDispatchActive,
    };

    await expect(
      (consumer as any).processPayload(payload, envelope)
    ).rejects.toBe(revoked);

    expect(assertDispatchActive).toHaveBeenCalledTimes(5);
    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledTimes(
      1
    );
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('publishes a status external id with the active runtime fence and a stable entity key', async () => {
    const { consumer, messageSendIdempotencyService, streamProducerService } =
      makeConsumer();
    const payload = {
      worker_id: 'worker-wwebjs',
      account_id: 'account-wwebjs',
      worker_profile_status_id: 'profile-status-current',
      worker_profile_status_type_id: EWorkerProfileStatusType.text,
      value: 'Status current',
      is_permanent: false,
    };
    const envelope = {
      sourceTopic: 'worker.worker-wwebjs.send.message',
      partition: 0,
      offset: 44,
      kafkaKey: null,
      payload,
      queueKey: 'profile_status:profile-status-current',
      chatId: null,
      assertDispatchActive: () => undefined,
    };

    await expect(
      (consumer as any).processPayload(payload, envelope)
    ).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.profile.status.external-id',
      {
        worker_profile_status_id: 'profile-status-current',
        external_id: 'status-external-id',
        event_id:
          'profile-status-external-id:v1:account-wwebjs:worker-wwebjs:profile-status-current:status-external-id',
        account_id: 'account-wwebjs',
        worker_id: 'worker-wwebjs',
        source_provider: 'wwebjs',
        runtime_generation: 7,
        connection_epoch: 'connection-wwebjs-7',
      },
      'account-wwebjs:worker-wwebjs:profile-status-current',
      undefined,
      expect.any(Function)
    );
    expect(
      messageSendIdempotencyService.markSucceeded.mock.invocationCallOrder[0]
    ).toBeLessThan(streamProducerService.send.mock.invocationCallOrder[0]);
  });

  it('uses an independent durable provider boundary for every profile mutation', async () => {
    const { consumer, messageSendIdempotencyService, wwebjsProfileService } =
      makeConsumer();
    const payload = {
      worker_id: 'worker-wwebjs',
      account_id: 'account-wwebjs',
      name: 'Underchat',
      message: 'Disponível',
      photo: null,
    };
    const envelope = {
      sourceTopic: 'worker.worker-wwebjs.send.message',
      partition: 1,
      offset: 42,
      kafkaKey: null,
      payload,
      queueKey: 'profile_info:worker-wwebjs:account-wwebjs',
      chatId: null,
      assertDispatchActive: jest.fn(() => undefined),
    };

    await expect(
      (consumer as any).processPayload(payload, envelope)
    ).resolves.toBeUndefined();

    expect(wwebjsProfileService.updateProfileName).toHaveBeenCalledWith(
      'Underchat',
      expect.any(Function)
    );
    expect(wwebjsProfileService.updateProfileStatus).toHaveBeenCalledWith(
      'Disponível',
      expect.any(Function)
    );
    expect(wwebjsProfileService.removeProfilePicture).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(3);
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledTimes(
      3
    );
    expect(messageSendIdempotencyService.claimOperation).toHaveBeenCalledTimes(
      3
    );
    expect(
      (
        messageSendIdempotencyService.claimOperation.mock
          .calls as unknown as Array<[Record<string, unknown>]>
      ).map(([input]) => input.operationId)
    ).toEqual([
      'worker-command\u0000worker.worker-wwebjs.send.message\u00001\u000042\u0000profile-info:name',
      'worker-command\u0000worker.worker-wwebjs.send.message\u00001\u000042\u0000profile-info:status',
      'worker-command\u0000worker.worker-wwebjs.send.message\u00001\u000042\u0000profile-info:photo',
    ]);
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
    expect(envelope.assertDispatchActive.mock.calls.length).toBeGreaterThan(3);
  });
});
