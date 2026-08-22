import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: jest.fn(() => 'annotation-1') }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { OfficialWhatsappMessageSendConsume } from '@core/consumer/message/OfficialWhatsappMessageSend.consume';
import { MetaGraphApiError } from '@core/services/metaWhatsappEmbedded.service';
import { MessageUpdatePublishFailedError } from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { ScheduleMessageInFlightLeaseUnavailableError } from '@core/services/scheduleStatusCoordination.service';
import { MessageSendIdempotencyService } from '@core/services/messageSendIdempotency.service';
import { buildScheduleSendAmbiguousRecovery } from '@core/common/functions/outboundAuxiliarySendRecovery';

const message: IChatMessage = {
  message_id: 'internal-message-1',
  chat_id: 'chat-1',
  message_key: {
    remote_jid: '5511999999999@s.whatsapp.net',
    is_view_once: false,
  },
  type_user: ETypeUserChat.operator,
  account: { id: 'account-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Official' },
  user: { id: 'user-1', name: 'Agent', photo: null },
  phone: '5511999999999',
  summary: {
    is_sent: false,
    is_delivered: false,
    is_seen: false,
    is_sent_to_internal: true,
  },
  date: '2026-06-01T10:00:00.000Z',
  content: {
    type: EMessageType.official_template,
    message: 'Ola Maycon',
    official_template: {
      name: 'hello_world',
      language: 'pt_BR',
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          value: 'Maycon',
        },
      ],
    },
  },
};

function makeEnvelope(payload: unknown = message) {
  return {
    sourceTopic: 'official.whatsapp.send.message',
    partition: 0,
    offset: 10,
    kafkaKey: 'account-1:chat-1',
    payload,
    queueKey: 'account-1:chat-1',
    chatId: 'chat-1',
    assertDispatchActive: jest.fn(),
  };
}

function providerRejectedRecovery(
  code = 132000,
  messageText = '(#132000) Parameter mismatch'
) {
  return {
    schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
    failure_kind: 'meta_graph_api_rejection',
    error: {
      message: messageText,
      code,
      error_subcode: null,
      type: 'OAuthException',
    },
  };
}

function makeConsumer(overrides?: {
  sendTemplateMessage?: jest.Mock;
  sendInteractiveMessage?: jest.Mock;
  sendTextMessage?: jest.Mock;
  sendImageMessage?: jest.Mock;
  sendLocationMessage?: jest.Mock;
  sendContactsMessage?: jest.Mock;
  sendReactionMessage?: jest.Mock;
  sendAudioMessage?: jest.Mock;
  uploadMediaFromUrl?: jest.Mock;
  streamSend?: jest.Mock;
  claimOperation?: jest.Mock;
  inspectOperation?: jest.Mock;
  recoverLegacyAmbiguous?: jest.Mock;
  markProviderInvoked?: jest.Mock;
  markSucceeded?: jest.Mock;
  markProviderRejected?: jest.Mock;
  markAmbiguous?: jest.Mock;
  releaseReservation?: jest.Mock;
  findActiveByWorkerId?: jest.Mock;
  withMessageInFlight?: jest.Mock;
  adoptMessageAttemptFromLedgerReservation?: jest.Mock;
  setMessageOperationalState?: jest.Mock;
  setMessageOperationalStateFromLedger?: jest.Mock;
  buildMetaComponents?: jest.Mock;
  officialWindowService?: {
    recordProviderAcceptedMessage: jest.Mock<Promise<void>, any[]>;
    recordTemplateFailureForMessage: jest.Mock<Promise<void>, any[]>;
    markClosedByMetaReengagementForMessage: jest.Mock<Promise<void>, any[]>;
  };
}) {
  const kafkaServiceQueueService = {
    officialWhatsappSendMessage: jest.fn(
      () => 'official.whatsapp.send.message'
    ),
    updateMessage: jest.fn(() => 'update.message'),
    updateMessageStatus: jest.fn(() => 'update.message.status'),
    scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
  };
  const streamProducerService = {
    send: overrides?.streamSend ?? jest.fn(async () => undefined),
  };
  const metaWhatsappEmbeddedService = {
    sendTemplateMessage:
      overrides?.sendTemplateMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.123',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendInteractiveMessage:
      overrides?.sendInteractiveMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.interactive',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendTextMessage:
      overrides?.sendTextMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.text',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendImageMessage:
      overrides?.sendImageMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.image',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendLocationMessage:
      overrides?.sendLocationMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.location',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendContactsMessage:
      overrides?.sendContactsMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.contacts',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendReactionMessage:
      overrides?.sendReactionMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.reaction',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendAudioMessage:
      overrides?.sendAudioMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.audio',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    uploadMediaFromUrl:
      overrides?.uploadMediaFromUrl ?? jest.fn(async () => 'meta-media-1'),
  };
  const messageStatusService = {
    markMessageAsNotSent: jest.fn(async () => undefined),
  };
  const chatMessageService = {
    publishPreparedMessage: jest.fn(async () => true),
  };
  const elasticDatabaseService = {
    indices: jest.fn(async () => undefined),
    updateField: jest.fn(async () => undefined),
  };
  const officialWindowService = overrides?.officialWindowService ?? {
    recordProviderAcceptedMessage: jest.fn(async () => undefined),
    recordTemplateFailureForMessage: jest.fn(async () => undefined),
    markClosedByMetaReengagementForMessage: jest.fn(async () => undefined),
  };
  const scheduleStatusCoordinationService = {
    withMessageInFlight:
      overrides?.withMessageInFlight ??
      jest.fn(
        async (
          _input: unknown,
          callback: (assertOwned: () => Promise<void>) => Promise<unknown>
        ) => callback(jest.fn(async () => undefined))
      ),
    adoptMessageAttemptFromLedgerReservation:
      overrides?.adoptMessageAttemptFromLedgerReservation ??
      jest.fn(async () => 'transitioned' as const),
    setMessageOperationalState:
      overrides?.setMessageOperationalState ??
      jest.fn(async () => 'transitioned' as const),
    ...(overrides?.setMessageOperationalStateFromLedger
      ? {
          setMessageOperationalStateFromLedger:
            overrides.setMessageOperationalStateFromLedger,
        }
      : {}),
  };
  const workerWhatsappOfficialConnectionRepository = {
    findActiveByWorkerId:
      overrides?.findActiveByWorkerId ??
      jest.fn(async () => ({
        worker_id: 'worker-1',
        waba_id: 'waba-1',
        phone_number_id: 'phone-number-1',
        access_token_encrypted: 'encrypted-token',
        api_version: 'v24.0',
      })),
  };
  const messageSendIdempotencyService = {
    claimOperation:
      overrides?.claimOperation ??
      jest.fn(async (input) => ({
        status: 'acquired' as const,
        state: 'reserved' as const,
        accountId: input.accountId,
        operationType: input.operationType,
        operationId: input.operationId,
        key: 'message-send:idempotency:v3:test',
        owner: 'owner-1',
        result: null,
      })),
    ...(overrides?.inspectOperation
      ? { inspectOperation: overrides.inspectOperation }
      : {}),
    recoverLegacyAmbiguous:
      overrides?.recoverLegacyAmbiguous ??
      jest.fn(async () => 'transitioned' as const),
    markProviderInvoked:
      overrides?.markProviderInvoked ??
      jest.fn(async () => 'transitioned' as const),
    markSucceeded:
      overrides?.markSucceeded ?? jest.fn(async () => 'transitioned' as const),
    markProviderRejected:
      overrides?.markProviderRejected ??
      jest.fn(async () => 'transitioned' as const),
    markAmbiguous:
      overrides?.markAmbiguous ?? jest.fn(async () => 'transitioned' as const),
    releaseReservation:
      overrides?.releaseReservation ??
      jest.fn(async () => 'transitioned' as const),
  };
  const officialWhatsappTemplateService = {
    buildMetaComponents:
      overrides?.buildMetaComponents ??
      jest.fn(() => [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Maycon' }],
        },
      ]),
  };
  const consumer = new OfficialWhatsappMessageSendConsume(
    {} as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    metaWhatsappEmbeddedService as never,
    { decrypt: jest.fn(() => 'plain-token') } as never,
    workerWhatsappOfficialConnectionRepository as never,
    messageSendIdempotencyService as never,
    messageStatusService as never,
    chatMessageService as never,
    officialWhatsappTemplateService as never,
    elasticDatabaseService as never,
    scheduleStatusCoordinationService as never,
    officialWindowService as never
  );

  return {
    consumer,
    kafkaServiceQueueService,
    metaWhatsappEmbeddedService,
    messageStatusService,
    chatMessageService,
    streamProducerService,
    elasticDatabaseService,
    officialWindowService,
    workerWhatsappOfficialConnectionRepository,
    messageSendIdempotencyService,
    scheduleStatusCoordinationService,
    officialWhatsappTemplateService,
  };
}

describe('OfficialWhatsappMessageSendConsume', () => {
  it('does not invoke Meta or failure side effects after assignment revocation', async () => {
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageStatusService,
      messageSendIdempotencyService,
    } = makeConsumer();
    const assertActive = jest.fn(() => {
      throw new KafkaConsumerDispatchRevokedError();
    });

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive,
        }
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(assertActive).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.claimOperation).not.toHaveBeenCalled();
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
  });

  it('keeps a direct official reservation uncommitted until an owner can cross the provider boundary', async () => {
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: message.message_id,
      key: 'official-direct-reserved-ledger',
      owner: null,
      result: null,
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer({ claimOperation });

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(claimOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'direct',
        operationId: message.message_id,
        reservationLeaseMs:
          MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
      })
    );
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
  });

  it('keeps the CAS owner as the sole Meta executor after assignment revocation at the provider boundary', async () => {
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer();
    const assertActive = jest
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new KafkaConsumerDispatchRevokedError();
      });

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive,
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledTimes(
      1
    );
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
  });

  it('sends official template messages to Meta and publishes update/status events', async () => {
    const {
      consumer,
      metaWhatsappEmbeddedService,
      streamProducerService,
      officialWindowService,
      messageSendIdempotencyService,
    } = makeConsumer();

    await (consumer as any).processPayload(message, makeEnvelope());

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v24.0',
        accessToken: 'plain-token',
        phoneNumberId: 'phone-number-1',
        to: '5511999999999',
        templateName: 'hello_world',
        language: 'pt_BR',
      })
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message',
      expect.objectContaining({
        event_id: expect.stringMatching(/^message_update_v1_[a-f0-9]{64}$/u),
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        data: expect.objectContaining({ message_id: 'internal-message-1' }),
        message: expect.objectContaining({
          key: expect.objectContaining({ id: 'wamid.123', fromMe: true }),
        }),
      }),
      'account-1:worker-1:internal-message-1',
      undefined,
      expect.any(Function)
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        event_id: expect.stringMatching(/^message_status_v1_[a-f0-9]{64}$/u),
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        message_id: 'wamid.123',
        patch: { is_sent: true },
      }),
      'account-1:worker-1:wamid.123',
      undefined,
      expect.any(Function)
    );
    expect(
      officialWindowService.recordProviderAcceptedMessage
    ).toHaveBeenCalledWith(message, 'wamid.123');
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'internal-message-1' }),
      expect.objectContaining({
        schema_version: 'message_send_ambiguous_terminal_v1',
        provider: 'official',
        operation_id: 'internal-message-1',
        status_update: expect.objectContaining({
          event_id: expect.stringMatching(/^message_status_v1_[a-f0-9]{64}$/u),
          message_id: 'internal-message-1',
          internal_message_id: 'internal-message-1',
          source_provider: 'official_whatsapp',
          failed: true,
          ambiguous: true,
        }),
      })
    );
    expect(
      messageSendIdempotencyService.markProviderInvoked.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      metaWhatsappEmbeddedService.sendTemplateMessage.mock
        .invocationCallOrder[0] as number
    );
  });

  it('uses the full remote-jid recipient for scheduled messages with a national phone', async () => {
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();
    const scheduledMessage: IChatMessage = {
      ...message,
      message_id: 'scheduled-template-message',
      chat_id: 'account-1:5511999999999@s.whatsapp.net',
      phone: '11999999999',
      phone_ddi: '55',
    };

    await (consumer as any).processPayload(
      scheduledMessage,
      makeEnvelope(scheduledMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledWith(expect.objectContaining({ to: '5511999999999' }));
  });

  it('falls back to the alternate non-LID jid when phone is absent', () => {
    const { consumer } = makeConsumer();
    const messageWithoutPhone = {
      ...message,
      phone: undefined,
      message_key: {
        remote_jid: '123456789@lid',
        remote_jid_alt: '5511888888888@s.whatsapp.net',
        is_view_once: false,
      },
    } as unknown as IChatMessage;

    expect((consumer as any).resolveRecipientPhone(messageWithoutPhone)).toBe(
      '5511888888888'
    );
  });

  it('forwards named template components built with parameter_name to Meta', async () => {
    const namedComponents = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maycon', parameter_name: 'name' },
          { type: 'text', text: '42', parameter_name: 'amount' },
        ],
      },
    ];
    const buildMetaComponents = jest.fn(() => namedComponents);
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer({
      buildMetaComponents,
    });
    const namedVariables = [
      {
        key: 'BODY:name',
        component_type: 'BODY' as const,
        index: 1,
        parameter_name: 'name',
        value: 'Maycon',
      },
      {
        key: 'BODY:amount',
        component_type: 'BODY' as const,
        index: 2,
        parameter_name: 'amount',
        value: '42',
      },
    ];
    const namedTemplateComponents = [
      {
        type: 'BODY',
        text: 'Olá {{name}}, valor {{amount}}',
      },
    ];
    const namedMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.official_template,
        message: 'Olá Maycon, valor 42',
        official_template: {
          name: 'service_update',
          language: 'pt_BR',
          parameter_format: 'NAMED',
          components: namedTemplateComponents,
          variables: namedVariables,
        },
      },
    };

    await (consumer as any).processPayload(
      namedMessage,
      makeEnvelope(namedMessage)
    );

    expect(buildMetaComponents).toHaveBeenCalledWith(
      namedVariables,
      namedTemplateComponents
    );
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({ components: namedComponents })
    );
  });

  it('keeps Graph delivery errors ambiguous after the provider boundary', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sendTemplateMessage = jest.fn(async () => {
      throw new Error('Graph error');
    });
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      messageSendIdempotencyService,
    } = makeConsumer({
      sendTemplateMessage,
    });

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      );

      expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'internal-message-1' }),
        expect.any(Error),
        expect.objectContaining({
          schema_version: 'message_send_ambiguous_terminal_v1',
          provider: 'official',
          operation_id: 'internal-message-1',
        })
      );
      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('keeps a live provider_invoked owner uncommitted without reinvoking Meta or publishing a premature terminal status', async () => {
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'provider_invoked' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: message.message_id,
      key: 'official-provider-invoked-live',
      owner: null,
      result: null,
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
      streamProducerService,
    } = makeConsumer({ claimOperation });

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.recoverLegacyAmbiguous
    ).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('replays an expired ambiguous provider attempt by publishing one terminal status and never reinvokes Meta', async () => {
    let recovery: unknown = null;
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'ambiguous' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: message.message_id,
      key: 'official-provider-invoked-replay',
      owner: null,
      result: recovery,
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
      streamProducerService,
    } = makeConsumer({ claimOperation });
    recovery = (consumer as any).buildDirectAmbiguousRecovery(
      message,
      message.message_id
    );

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).resolves.toBeUndefined();

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.recoverLegacyAmbiguous
    ).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        message_id: message.message_id,
        internal_message_id: message.message_id,
        terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
        source_provider: 'official_whatsapp',
        failed: true,
        ambiguous: true,
      }),
      `account-1:worker-1:${message.message_id}`,
      undefined,
      expect.any(Function)
    );
  });

  it('fails closed without committing when the provider outcome cannot transition to ambiguous', async () => {
    const providerError = new Error('meta_transport_result_unknown');
    const streamSend = jest.fn(async () => undefined);
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer({
      sendTemplateMessage: jest.fn(async () => {
        throw providerError;
      }),
      markAmbiguous: jest.fn(async () => 'error' as const),
      streamSend,
    });

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: message.message_id }),
      providerError,
      expect.objectContaining({
        schema_version: 'message_send_ambiguous_terminal_v1',
      })
    );
    expect(streamSend).not.toHaveBeenCalled();
  });

  it('fails closed when replay terminal status publication is unavailable', async () => {
    let recovery: unknown = null;
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'ambiguous' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: message.message_id,
      key: 'official-ambiguous-replay',
      owner: null,
      result: recovery,
    }));
    const streamSend = jest.fn(async () => {
      throw new Error('status topic unavailable');
    });
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer({
      claimOperation,
      streamSend,
    });
    recovery = (consumer as any).buildDirectAmbiguousRecovery(
      message,
      message.message_id
    );

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(streamSend).toHaveBeenCalledTimes(1);
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
  });

  it('routes an explicit Meta re-engagement rejection as a terminal failure', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const textMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.text,
        message: 'Mensagem livre',
      },
    };
    const sendTextMessage = jest.fn(async () => {
      throw new MetaGraphApiError({
        message: 'Re-engagement message',
        code: 131047,
      });
    });
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      messageSendIdempotencyService,
    } = makeConsumer({
      sendTextMessage,
    });

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        textMessage,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      );

      expect(
        officialWindowService.markClosedByMetaReengagementForMessage
      ).toHaveBeenCalledWith(textMessage, 131047);
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).not.toHaveBeenCalled();
      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1',
        expect.any(Function),
        'failed',
        expect.objectContaining({ errorCode: 131047 })
      );
      expect(
        messageSendIdempotencyService.markProviderRejected
      ).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'internal-message-1' }),
        expect.objectContaining({ code: 131047 }),
        expect.objectContaining({
          schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
          error: expect.objectContaining({ code: 131047 }),
        })
      );
      expect(
        messageSendIdempotencyService.markAmbiguous
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('marks Meta parameter mismatch 132000 as not sent and releases the pending template window', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const parameterMismatch = new MetaGraphApiError({
      message:
        '(#132000) Number of parameters does not match the expected number of params',
      code: 132000,
      type: 'OAuthException',
    });
    const sendTemplateMessage = jest.fn(async () => {
      throw parameterMismatch;
    });
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      messageSendIdempotencyService,
    } = makeConsumer({ sendTemplateMessage });

    try {
      await expect(
        (consumer as any).processRunnerPayload(
          'official.whatsapp.send.message',
          message,
          {
            partition: 0,
            offset: 10,
            kafkaKey: 'account-1:chat-1',
            assertActive: jest.fn(),
          }
        )
      ).resolves.toBeUndefined();

      expect(message.summary).toEqual(
        expect.objectContaining({ is_sent: false })
      );
      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1',
        expect.any(Function),
        'failed',
        expect.objectContaining({ errorCode: 132000 })
      );
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).toHaveBeenCalledWith(message, 132000);
      expect(
        messageSendIdempotencyService.markProviderRejected
      ).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'internal-message-1' }),
        parameterMismatch,
        expect.objectContaining({
          schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
          failure_kind: 'meta_graph_api_rejection',
          error: expect.objectContaining({
            code: 132000,
            message: parameterMismatch.message,
          }),
        })
      );
      expect(
        messageSendIdempotencyService.markAmbiguous
      ).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordProviderAcceptedMessage
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('preserves an ambiguous outcome when the definitive rejection cannot be persisted as failed', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
    });
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      messageSendIdempotencyService,
    } = makeConsumer({
      sendTemplateMessage: jest.fn(async () => {
        throw parameterMismatch;
      }),
      markProviderRejected: jest.fn(async () => 'error' as const),
    });

    try {
      await expect(
        (consumer as any).processRunnerPayload(
          'official.whatsapp.send.message',
          message,
          {
            partition: 0,
            offset: 10,
            kafkaKey: 'account-1:chat-1',
            assertActive: jest.fn(),
          }
        )
      ).resolves.toBeUndefined();

      expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'internal-message-1' }),
        parameterMismatch,
        expect.objectContaining({
          schema_version: 'message_send_ambiguous_terminal_v1',
          provider: 'official',
        })
      );
      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('routes official interactive messages to Meta interactive send', async () => {
    const interactiveMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.official_interactive,
        message: 'Escolha',
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          raw: {
            type: 'button',
            interactive: {
              type: 'button',
              body: { text: 'Escolha' },
              action: {
                buttons: [
                  {
                    type: 'reply',
                    reply: { id: '1', title: 'Sim' },
                  },
                ],
              },
            },
          },
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      interactiveMessage,
      makeEnvelope(interactiveMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendInteractiveMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v24.0',
        accessToken: 'plain-token',
        phoneNumberId: 'phone-number-1',
        to: '5511999999999',
        interactive: {
          type: 'button',
          body: { text: 'Escolha' },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: { id: '1', title: 'Sim' },
              },
            ],
          },
        },
      })
    );
  });

  it('preserves the CTA URL contract when dispatching to Meta', async () => {
    const googleSitesUrl =
      'https://sites.google.com/contabilidadehohl.com.br/atendimento';
    const interactiveMessage: IChatMessage = {
      ...message,
      message_id: 'internal-cta-message-1',
      content: {
        type: EMessageType.official_interactive,
        message: 'Abrir link',
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          raw: {
            type: 'cta_url',
            interactive: {
              type: 'cta_url',
              header: { type: 'text', text: 'CTA URL' },
              body: { text: 'Abrir link' },
              action: {
                name: 'cta_url',
                parameters: {
                  display_text: 'Clique aqui',
                  url: googleSitesUrl,
                },
              },
            },
          },
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      interactiveMessage,
      makeEnvelope(interactiveMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendInteractiveMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v24.0',
        accessToken: 'plain-token',
        phoneNumberId: 'phone-number-1',
        to: '5511999999999',
        interactive: {
          type: 'cta_url',
          header: { type: 'text', text: 'CTA URL' },
          body: { text: 'Abrir link' },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Clique aqui',
              url: googleSitesUrl,
            },
          },
        },
      })
    );
  });

  it('rejects an invalid queued interactive before invoking Meta', async () => {
    const interactiveMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.official_interactive,
        message: 'Escolha',
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          raw: {
            type: 'button',
            interactive: {
              type: 'button',
              body: { text: 'Escolha' },
              action: {
                buttons: Array.from({ length: 4 }, (_, index) => ({
                  type: 'reply',
                  reply: { id: String(index), title: `Opção ${index}` },
                })),
              },
            },
          },
        },
      },
    };
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer();

    await expect(
      (consumer as any).processPayload(
        interactiveMessage,
        makeEnvelope(interactiveMessage)
      )
    ).rejects.toThrow('official_whatsapp_interactive_limit_exceeded');

    expect(
      metaWhatsappEmbeddedService.sendInteractiveMessage
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.releaseReservation).toHaveBeenCalled();
  });

  it('sends text messages with quote context when quoted message has a Meta id', async () => {
    const textMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.text,
        message: 'Resposta',
        quoted: {
          key: {
            id: 'wamid.quoted',
            remote_jid: '5511999999999@s.whatsapp.net',
            is_view_once: false,
          },
          message: 'Original',
          type: EMessageType.text,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      textMessage,
      makeEnvelope(textMessage)
    );

    expect(metaWhatsappEmbeddedService.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Resposta',
        contextMessageId: 'wamid.quoted',
      })
    );
  });

  it('uploads image media before sending it to Meta', async () => {
    const imageMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.image,
        message: 'Legenda',
        image: {
          url: 'http://minio.local/file.jpg',
          mimetype: 'image/jpeg',
          caption: 'Legenda da imagem',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      imageMessage,
      makeEnvelope(imageMessage)
    );

    expect(metaWhatsappEmbeddedService.uploadMediaFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://minio.local/file.jpg',
        mimetype: 'image/jpeg',
      })
    );
    expect(metaWhatsappEmbeddedService.sendImageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'meta-media-1',
        caption: 'Legenda da imagem',
      })
    );
  });

  it('sends locations through the official Meta payload', async () => {
    const locationMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.location,
        location: {
          latitude: -15.8,
          longitude: -47.9,
          name: 'Brasilia',
          address: 'DF',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      locationMessage,
      makeEnvelope(locationMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendLocationMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: -15.8,
        longitude: -47.9,
        name: 'Brasilia',
        address: 'DF',
      })
    );
  });

  it('maps contact cards to Meta contacts with normalized DDI and phone', async () => {
    const contactMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.contact_card,
        contact: {
          contact_id: 'contact-1',
          name: 'Braian',
          last_name: 'Silva',
          phone_ddi: '55',
          phone: '(61) 99121-1783',
          email: 'braian@example.test',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      contactMessage,
      makeEnvelope(contactMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendContactsMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: [
          expect.objectContaining({
            name: expect.objectContaining({
              formatted_name: 'Braian Silva',
              first_name: 'Braian',
              last_name: 'Silva',
            }),
            phones: [
              expect.objectContaining({
                phone: '+55 61991211783',
                wa_id: '5561991211783',
              }),
            ],
          }),
        ],
      })
    );
  });

  it('sends reactions to the target Meta message id', async () => {
    const reactionMessage: IChatMessage = {
      ...message,
      message_key: {
        remote_jid: '5511999999999@s.whatsapp.net',
        id: 'wamid.target',
        is_view_once: false,
      },
      content: {
        type: EMessageType.react,
        message: '👍',
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      reactionMessage,
      makeEnvelope(reactionMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendReactionMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'wamid.target',
        emoji: '👍',
      })
    );
  });

  it('sends official ptt audio as a Meta voice message', async () => {
    const audioMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.audio,
        audio: {
          url: 'http://minio.local/audio.ogg',
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      audioMessage,
      makeEnvelope(audioMessage)
    );

    expect(metaWhatsappEmbeddedService.uploadMediaFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://minio.local/audio.ogg',
        mimetype: 'audio/ogg; codecs=opus',
      })
    );
    expect(metaWhatsappEmbeddedService.sendAudioMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'meta-media-1',
        voice: true,
      })
    );
  });

  it('marks official audio view-once messages as not sent without uploading media', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const audioMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.audio,
        audio: {
          url: 'http://minio.local/audio.ogg',
          mimetype: 'audio/ogg',
          view_once: true,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService, messageStatusService } =
      makeConsumer();

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        audioMessage,
        {
          partition: 0,
          offset: 11,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1',
        expect.any(Function)
      );
      expect(
        metaWhatsappEmbeddedService.uploadMediaFromUrl
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('marks unsupported official message types as not sent', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const unsupportedMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.video_note,
        message: 'video note',
      },
    };
    const { consumer, messageStatusService } = makeConsumer();

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        unsupportedMessage,
        {
          partition: 0,
          offset: 11,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1',
        expect.any(Function)
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('keeps a live official provider owner uncommitted before a divergent attempt lease', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-official-live-prelease',
      contact_id: 'contact-official-live-prelease',
      account_id: 'account-1',
      attempt_id: 'attempt-replacement',
      is_validated: true,
      message,
    };
    const inspectOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'provider_invoked' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-live-prelease-ledger',
      owner: null,
      result: null,
    }));
    const withMessageInFlight = jest.fn();
    const sendTemplateMessage = jest.fn();
    const { consumer, streamProducerService } = makeConsumer({
      inspectOperation,
      withMessageInFlight,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(withMessageInFlight).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('recovers an expired official provider boundary before a divergent attempt lease without a second Meta request', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-official-prelease',
      contact_id: 'contact-official-prelease',
      account_id: 'account-1',
      attempt_id: 'attempt-replacement',
      is_validated: true,
      message,
    };
    const recovery = buildScheduleSendAmbiguousRecovery({
      provider: 'official',
      operationId: message.message_id,
      scheduleId: schedulePayload.schedule_id,
      contactId: schedulePayload.contact_id,
      messageId: message.message_id,
      attemptId: 'attempt-original',
      accountId: 'account-1',
      workerId: 'worker-1',
    });
    const inspectOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'ambiguous' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-prelease-ledger',
      owner: null,
      result: recovery,
    }));
    const setMessageOperationalStateFromLedger = jest.fn(
      async () => 'transitioned' as const
    );
    const withMessageInFlight = jest.fn(async () => {
      throw new Error('attempt lease must not be entered');
    });
    const sendTemplateMessage = jest.fn();
    const {
      consumer,
      messageSendIdempotencyService,
      scheduleStatusCoordinationService,
    } = makeConsumer({
      inspectOperation,
      setMessageOperationalStateFromLedger,
      withMessageInFlight,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).resolves.toBeUndefined();

    expect(inspectOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'schedule',
        operationId: message.message_id,
        compatibleLegacyMetaKeys: ['attempt_id'],
      })
    );
    expect(setMessageOperationalStateFromLedger).toHaveBeenCalledWith(
      {
        scheduleId: schedulePayload.schedule_id,
        accountId: 'account-1',
        workerId: 'worker-1',
        messageId: message.message_id,
        attemptId: schedulePayload.attempt_id,
        ledgerOperationId: message.message_id,
      },
      'ambiguous'
    );
    expect(
      scheduleStatusCoordinationService.withMessageInFlight
    ).not.toHaveBeenCalled();
    expect(messageSendIdempotencyService.claimOperation).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('replays durable scheduled provider-rejection effects before entering a divergent attempt lease', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-official-rejected-prelease',
      contact_id: 'contact-official-rejected-prelease',
      account_id: 'account-1',
      attempt_id: 'attempt-replacement',
      is_validated: true,
      message,
    };
    const inspectOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'failed' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-rejected-prelease-ledger',
      owner: null,
      result: providerRejectedRecovery(),
    }));
    const setMessageOperationalStateFromLedger = jest.fn(
      async () => 'transitioned' as const
    );
    const withMessageInFlight = jest.fn();
    const sendTemplateMessage = jest.fn();
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      scheduleStatusCoordinationService,
      streamProducerService,
    } = makeConsumer({
      inspectOperation,
      setMessageOperationalStateFromLedger,
      withMessageInFlight,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).resolves.toBeUndefined();

    expect(
      scheduleStatusCoordinationService.setMessageOperationalStateFromLedger
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: schedulePayload.schedule_id,
        attemptId: schedulePayload.attempt_id,
        ledgerOperationId: message.message_id,
      }),
      'provider_rejected'
    );
    expect(
      scheduleStatusCoordinationService.setMessageOperationalState
    ).not.toHaveBeenCalled();
    expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
      'account-1',
      message.message_id,
      expect.any(Function),
      'failed',
      expect.objectContaining({ errorCode: 132000 })
    );
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).toHaveBeenCalledWith(message, 132000);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'schedule.status.update',
      expect.objectContaining({
        schedule_id: schedulePayload.schedule_id,
        status: EScheduleStatus.failed,
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
    expect(withMessageInFlight).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('keeps an official reserved schedule uncommitted while its current owner is live', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-official-reserved-current',
      contact_id: 'contact-official-reserved-current',
      account_id: 'account-1',
      attempt_id: 'attempt-replacement',
      is_validated: true,
      message,
    };
    const inspectOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-reserved-current-ledger',
      owner: null,
      result: null,
    }));
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-reserved-current-ledger',
      owner: null,
      result: null,
    }));
    const withMessageInFlight = jest.fn();
    const adoptMessageAttemptFromLedgerReservation = jest.fn();
    const sendTemplateMessage = jest.fn();
    const { consumer } = makeConsumer({
      inspectOperation,
      claimOperation,
      withMessageInFlight,
      adoptMessageAttemptFromLedgerReservation,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(claimOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'schedule',
        operationId: message.message_id,
        reservationLeaseMs:
          MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
      })
    );
    expect(adoptMessageAttemptFromLedgerReservation).not.toHaveBeenCalled();
    expect(withMessageInFlight).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('claims the official provider ledger before adopting a divergent attempt and calls Meta once', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-official-reserved-takeover',
      contact_id: 'contact-official-reserved-takeover',
      account_id: 'account-1',
      attempt_id: 'attempt-replacement',
      is_validated: true,
      message,
    };
    const acquiredClaim = {
      status: 'acquired' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: 'official-reserved-takeover-ledger',
      owner: 'official-replacement-owner',
      result: null,
    };
    const inspectOperation = jest.fn(async () => ({
      status: 'not_found' as const,
      state: null,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: message.message_id,
      key: acquiredClaim.key,
      owner: null,
      result: null,
    }));
    const claimOperation = jest.fn(async () => acquiredClaim);
    const adoptMessageAttemptFromLedgerReservation = jest.fn(
      async () => 'transitioned' as const
    );
    const sendTemplateMessage = jest.fn(async () => ({
      message_id: 'wamid.official-takeover',
      contact_wa_id: '5511999999999',
      message_status: 'accepted',
      raw: { messaging_product: 'whatsapp' },
    }));
    const {
      consumer,
      messageSendIdempotencyService,
      scheduleStatusCoordinationService,
    } = makeConsumer({
      inspectOperation,
      claimOperation,
      adoptMessageAttemptFromLedgerReservation,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).resolves.toBeUndefined();

    expect(claimOperation).toHaveBeenCalledTimes(1);
    expect(adoptMessageAttemptFromLedgerReservation).toHaveBeenCalledWith({
      scheduleId: schedulePayload.schedule_id,
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: message.message_id,
      attemptId: schedulePayload.attempt_id,
      ledgerOperationId: message.message_id,
      ledgerReservationOwner: acquiredClaim.owner,
    });
    expect(
      scheduleStatusCoordinationService.withMessageInFlight
    ).toHaveBeenCalledTimes(1);
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledWith(
      acquiredClaim,
      expect.objectContaining({
        schema_version: 'schedule_send_ambiguous_recovery_v1',
        provider: 'official',
        operation_id: message.message_id,
      })
    );
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledTimes(
      1
    );
  });

  it('processes official schedule envelopes and publishes sent status/log', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-1',
      attempt_id: 'attempt-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const {
      consumer,
      streamProducerService,
      elasticDatabaseService,
      messageSendIdempotencyService,
      scheduleStatusCoordinationService,
    } = makeConsumer();

    await (consumer as any).processPayload(
      schedulePayload,
      makeEnvelope(schedulePayload)
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'schedule.status.update',
      expect.objectContaining({
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        message_id: 'internal-message-1',
        attempt_id: 'attempt-1',
        status: EScheduleStatus.sent,
      }),
      'schedule-1:contact-1:internal-message-1',
      undefined,
      expect.any(Function)
    );
    expect(elasticDatabaseService.updateField).toHaveBeenCalledWith(
      expect.any(String),
      'internal-message-1',
      'send_log',
      expect.objectContaining({
        success: true,
        error: null,
        payload: message.content,
      }),
      3
    );
    expect(
      scheduleStatusCoordinationService.withMessageInFlight
    ).toHaveBeenCalledWith(
      {
        scheduleId: 'schedule-1',
        accountId: 'account-1',
        workerId: 'worker-1',
        messageId: 'internal-message-1',
        attemptId: 'attempt-1',
      },
      expect.any(Function)
    );
    expect(messageSendIdempotencyService.claimOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'schedule',
        operationId: 'internal-message-1',
        meta: expect.objectContaining({
          schedule_id: 'schedule-1',
        }),
      })
    );
    expect(
      messageSendIdempotencyService.claimOperation.mock.calls[0][0].meta
    ).not.toHaveProperty('attempt_id');
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'schedule',
        operationId: 'internal-message-1',
      }),
      expect.objectContaining({
        schema_version: 'schedule_send_ambiguous_recovery_v1',
        provider: 'official',
        operation_id: 'internal-message-1',
        attempt_id: 'attempt-1',
      })
    );
  });

  it('records a scheduled Meta rejection as provider_rejected and applies terminal failure effects', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
    });
    const schedulePayload = {
      schedule_id: 'schedule-parameter-mismatch',
      attempt_id: 'attempt-parameter-mismatch',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      messageSendIdempotencyService,
      scheduleStatusCoordinationService,
      streamProducerService,
    } = makeConsumer({
      sendTemplateMessage: jest.fn(async () => {
        throw parameterMismatch;
      }),
    });

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).resolves.toBeUndefined();

      expect(
        scheduleStatusCoordinationService.setMessageOperationalState
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          scheduleId: 'schedule-parameter-mismatch',
          messageId: 'internal-message-1',
        }),
        'provider_rejected'
      );
      expect(
        messageSendIdempotencyService.markProviderRejected
      ).toHaveBeenCalledWith(
        expect.any(Object),
        parameterMismatch,
        expect.objectContaining({
          schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
          error: expect.objectContaining({ code: 132000 }),
        })
      );
      expect(
        messageSendIdempotencyService.markAmbiguous
      ).not.toHaveBeenCalled();
      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1',
        expect.any(Function),
        'failed',
        expect.objectContaining({ errorCode: 132000 })
      );
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).toHaveBeenCalledWith(message, 132000);
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'schedule.status.update',
        expect.objectContaining({
          schedule_id: 'schedule-parameter-mismatch',
          status: EScheduleStatus.failed,
        }),
        expect.any(String),
        undefined,
        expect.any(Function)
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('does not overwrite a conflicting durable schedule outcome after Meta rejects the attempt', async () => {
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
    });
    const setMessageOperationalState = jest
      .fn()
      .mockResolvedValueOnce('invalid');
    const schedulePayload = {
      schedule_id: 'schedule-rejected-conflict',
      attempt_id: 'attempt-rejected-conflict',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const {
      consumer,
      messageStatusService,
      officialWindowService,
      streamProducerService,
    } = makeConsumer({
      setMessageOperationalState,
      sendTemplateMessage: jest.fn(async () => {
        throw parameterMismatch;
      }),
    });
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).resolves.toBeUndefined();

      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).not.toHaveBeenCalled();
      expect(streamProducerService.send).not.toHaveBeenCalledWith(
        'schedule.status.update',
        expect.objectContaining({ status: EScheduleStatus.failed }),
        expect.any(String),
        undefined,
        expect.any(Function)
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('retries a persisted scheduled rejection when operational coordination is unavailable', async () => {
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
    });
    const setMessageOperationalState = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis unavailable'));
    const schedulePayload = {
      schedule_id: 'schedule-rejected-coordination-error',
      attempt_id: 'attempt-rejected-coordination-error',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const { consumer, messageStatusService, officialWindowService } =
      makeConsumer({
        setMessageOperationalState,
        sendTemplateMessage: jest.fn(async () => {
          throw parameterMismatch;
        }),
      });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).not.toHaveBeenCalled();
  });

  it('redelivers a scheduled persisted rejection to finish side effects without another Meta request', async () => {
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
      type: 'OAuthException',
    });
    const schedulePayload = {
      schedule_id: 'schedule-rejected-recovery',
      attempt_id: 'attempt-rejected-recovery',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const acquiredClaim = {
      status: 'acquired' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-schedule-rejected',
      owner: 'owner-1',
      result: null,
    };
    const claimOperation = jest
      .fn()
      .mockResolvedValueOnce(acquiredClaim)
      .mockResolvedValueOnce({
        ...acquiredClaim,
        status: 'duplicate' as const,
        state: 'failed' as const,
        owner: null,
        result: providerRejectedRecovery(),
      });
    const recordTemplateFailureForMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('window storage unavailable'))
      .mockResolvedValue(undefined);
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageStatusService,
      streamProducerService,
      elasticDatabaseService,
    } = makeConsumer({
      claimOperation,
      sendTemplateMessage: jest.fn(async () => {
        throw parameterMismatch;
      }),
      officialWindowService: {
        recordProviderAcceptedMessage: jest.fn(async () => undefined),
        recordTemplateFailureForMessage,
        markClosedByMetaReengagementForMessage: jest.fn(async () => undefined),
      },
    });
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).resolves.toBeUndefined();

      expect(
        metaWhatsappEmbeddedService.sendTemplateMessage
      ).toHaveBeenCalledTimes(1);
      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledTimes(
        2
      );
      expect(recordTemplateFailureForMessage).toHaveBeenCalledTimes(2);
      expect(recordTemplateFailureForMessage).toHaveBeenLastCalledWith(
        message,
        132000
      );
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'schedule.status.update',
        expect.objectContaining({
          schedule_id: 'schedule-rejected-recovery',
          status: EScheduleStatus.failed,
        }),
        expect.any(String),
        undefined,
        expect.any(Function)
      );
      expect(elasticDatabaseService.updateField).toHaveBeenCalledWith(
        EElasticIndex.schedule,
        'internal-message-1',
        'send_log',
        expect.objectContaining({
          success: false,
          error: parameterMismatch.message,
        }),
        3
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('keeps an official schedule attempt uncommitted when the distributed lease is unavailable', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-busy',
      attempt_id: 'attempt-busy',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const consoleSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer({
      withMessageInFlight: jest.fn(async () => {
        throw new ScheduleMessageInFlightLeaseUnavailableError(
          'schedule-busy',
          'internal-message-1'
        );
      }),
    });

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(
        messageSendIdempotencyService.claimOperation
      ).not.toHaveBeenCalled();
      expect(
        metaWhatsappEmbeddedService.sendTemplateMessage
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('rechecks the official schedule attempt immediately before invoking Meta', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-lease-lost',
      attempt_id: 'attempt-lease-lost',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const assertOwned = jest
      .fn<Promise<void>, []>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ScheduleMessageInFlightLeaseUnavailableError(
          'schedule-lease-lost',
          'internal-message-1'
        )
      );
    const consoleSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer({
      withMessageInFlight: jest.fn(
        async (
          _input: unknown,
          callback: (assertLeaseActive: () => Promise<void>) => Promise<void>
        ) => callback(assertOwned)
      ),
    });

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

      expect(
        messageSendIdempotencyService.claimOperation
      ).toHaveBeenCalledTimes(1);
      expect(
        messageSendIdempotencyService.releaseReservation
      ).toHaveBeenCalledTimes(1);
      expect(
        messageSendIdempotencyService.markProviderInvoked
      ).not.toHaveBeenCalled();
      expect(
        metaWhatsappEmbeddedService.sendTemplateMessage
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('persists a known scheduled Meta ACK before a post-provider lease loss', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-ack-before-lease-loss',
      attempt_id: 'attempt-ack-before-lease-loss',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const assertOwned = jest
      .fn<Promise<void>, []>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ScheduleMessageInFlightLeaseUnavailableError(
          schedulePayload.schedule_id,
          message.message_id
        )
      );
    const sendTemplateMessage = jest.fn(async () => ({
      message_id: 'wamid.known-before-lease-loss',
      contact_wa_id: '5511999999999',
      message_status: 'accepted',
      raw: { messaging_product: 'whatsapp' },
    }));
    const {
      consumer,
      messageSendIdempotencyService,
      scheduleStatusCoordinationService,
    } = makeConsumer({
      sendTemplateMessage,
      withMessageInFlight: jest.fn(
        async (
          _input: unknown,
          callback: (assertLeaseActive: () => Promise<void>) => Promise<void>
        ) => callback(assertOwned)
      ),
    });

    await expect(
      (consumer as any).processPayload(
        schedulePayload,
        makeEnvelope(schedulePayload)
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: message.message_id }),
      expect.objectContaining({
        schema_version: 'official_whatsapp_send_recovery_v1',
        provider_result: expect.objectContaining({
          message_id: 'wamid.known-before-lease-loss',
        }),
      })
    );
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
    expect(
      scheduleStatusCoordinationService.setMessageOperationalState
    ).not.toHaveBeenCalled();
  });

  it('keeps an official schedule ACK ambiguity terminal without failed side effects', async () => {
    const consoleSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let attemptLeaseActive = false;
    const withMessageInFlight = jest.fn(
      async (
        _input: unknown,
        callback: (assertOwned: () => Promise<void>) => Promise<unknown>
      ) => {
        attemptLeaseActive = true;
        try {
          return await callback(jest.fn(async () => undefined));
        } finally {
          attemptLeaseActive = false;
        }
      }
    );
    const schedulePayload = {
      schedule_id: 'schedule-1',
      attempt_id: 'attempt-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const {
      consumer,
      streamProducerService,
      elasticDatabaseService,
      messageStatusService,
      messageSendIdempotencyService,
    } = makeConsumer({
      withMessageInFlight,
      sendTemplateMessage: jest.fn(async () => {
        throw new Error('meta_terminal_error');
      }),
    });
    const routeFailedMessage = (consumer as any).routeFailedMessage.bind(
      consumer
    );
    const routeSpy = jest
      .spyOn(consumer as any, 'routeFailedMessage')
      .mockImplementation(async (...args: unknown[]) => {
        expect(attemptLeaseActive).toBe(true);
        return routeFailedMessage(...args);
      });

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        schedulePayload,
        {
          partition: 0,
          offset: 12,
          kafkaKey: 'account:account-1:channel:worker-1',
          assertActive: jest.fn(),
        }
      );

      expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledTimes(
        1
      );
      expect(
        messageSendIdempotencyService.releaseReservation
      ).not.toHaveBeenCalled();
      expect(routeSpy).not.toHaveBeenCalled();
      expect(streamProducerService.send).not.toHaveBeenCalledWith(
        'schedule.status.update',
        expect.objectContaining({ status: EScheduleStatus.failed }),
        expect.any(String)
      );
      expect(elasticDatabaseService.updateField).not.toHaveBeenCalled();
      expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('recovers terminal effects after a persisted Meta rejection without calling Meta twice', async () => {
    const parameterMismatch = new MetaGraphApiError({
      message: '(#132000) Parameter mismatch',
      code: 132000,
      type: 'OAuthException',
    });
    const acquiredClaim = {
      status: 'acquired' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-rejected-test',
      owner: 'owner-1',
      result: null,
    };
    const claimOperation = jest
      .fn()
      .mockResolvedValueOnce(acquiredClaim)
      .mockResolvedValueOnce({
        ...acquiredClaim,
        status: 'duplicate' as const,
        state: 'failed' as const,
        owner: null,
        result: providerRejectedRecovery(),
      });
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer({
      claimOperation,
      sendTemplateMessage: jest.fn(async () => {
        throw parameterMismatch;
      }),
    });
    messageStatusService.markMessageAsNotSent
      .mockRejectedValueOnce(new Error('message status unavailable'))
      .mockResolvedValue(undefined);
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        (consumer as any).processRunnerPayload(
          'official.whatsapp.send.message',
          message,
          {
            partition: 0,
            offset: 10,
            kafkaKey: 'account-1:chat-1',
            assertActive: jest.fn(),
          }
        )
      ).rejects.toMatchObject({
        name: 'MessageUpdatePublishFailedError',
        originalCause: expect.objectContaining({
          message: 'message status unavailable',
        }),
      });

      await expect(
        (consumer as any).processRunnerPayload(
          'official.whatsapp.send.message',
          message,
          {
            partition: 0,
            offset: 10,
            kafkaKey: 'account-1:chat-1',
            assertActive: jest.fn(),
          }
        )
      ).resolves.toBeUndefined();

      expect(
        metaWhatsappEmbeddedService.sendTemplateMessage
      ).toHaveBeenCalledTimes(1);
      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledTimes(
        2
      );
      expect(
        officialWindowService.recordTemplateFailureForMessage
      ).toHaveBeenCalledWith(message, 132000);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('does not replay effects for legacy or pre-provider failed claims without recovery data', async () => {
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'failed' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:legacy-failed-test',
      owner: null,
      result: null,
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageStatusService,
      officialWindowService,
    } = makeConsumer({ claimOperation });

    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).resolves.toBeUndefined();

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(messageStatusService.markMessageAsNotSent).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).not.toHaveBeenCalled();
  });

  it('retries a failed update publication from succeeded state without calling Meta twice', async () => {
    const update = {
      message: {
        key: {
          id: 'wamid.123',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
      },
      data: message,
    };
    const acquiredClaim = {
      status: 'acquired' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-test',
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
        result: { update_message: update },
      });
    const { consumer, metaWhatsappEmbeddedService, streamProducerService } =
      makeConsumer({ claimOperation });
    streamProducerService.send
      .mockRejectedValueOnce(new Error('update Kafka unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);
    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).resolves.toBeUndefined();

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).toHaveBeenCalledTimes(3);
    expect(
      (streamProducerService.send.mock.calls as unknown[][])[1][1]
    ).toEqual(
      expect.objectContaining({
        ...update,
        event_id: expect.stringMatching(/^message_update_v1_[a-f0-9]{64}$/u),
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
      })
    );
    expect((streamProducerService.send.mock.calls as unknown[][])[2][0]).toBe(
      'update.message.status'
    );
  });

  it('recovers every durable effect of an official scheduled success', async () => {
    const schedulePayload = {
      schedule_id: 'schedule-recovery-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message,
    };
    const update = {
      message: { key: { id: 'wamid.recovered', fromMe: true } },
      data: message,
    };
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'succeeded' as const,
      accountId: 'account-1',
      operationType: 'schedule' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-schedule-test',
      owner: null,
      result: { update_message: update },
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      streamProducerService,
      officialWindowService,
      elasticDatabaseService,
    } = makeConsumer({ claimOperation });

    await (consumer as any).processPayload(
      schedulePayload,
      makeEnvelope(schedulePayload)
    );

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenNthCalledWith(
      1,
      'update.message',
      expect.objectContaining({
        ...update,
        event_id: expect.stringMatching(/^message_update_v1_[a-f0-9]{64}$/u),
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
      }),
      'account-1:worker-1:internal-message-1',
      undefined,
      expect.any(Function)
    );
    expect(streamProducerService.send).toHaveBeenNthCalledWith(
      2,
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        message_id: 'wamid.recovered',
        patch: { is_sent: true },
      }),
      'account-1:worker-1:wamid.recovered',
      undefined,
      expect.any(Function)
    );
    expect(streamProducerService.send).toHaveBeenNthCalledWith(
      3,
      'schedule.status.update',
      expect.objectContaining({
        schedule_id: 'schedule-recovery-1',
        contact_id: 'contact-1',
        message_id: 'internal-message-1',
        status: EScheduleStatus.sent,
      }),
      'schedule-recovery-1:contact-1:internal-message-1',
      undefined,
      expect.any(Function)
    );
    expect(
      officialWindowService.recordProviderAcceptedMessage
    ).toHaveBeenCalledWith(message, 'wamid.recovered');
    expect(elasticDatabaseService.updateField).toHaveBeenCalledWith(
      EElasticIndex.schedule,
      'internal-message-1',
      'send_log',
      expect.objectContaining({
        success: true,
        result: expect.objectContaining({ message_id: 'wamid.recovered' }),
      }),
      3
    );
  });

  it('recovers a durable annotation with the original identity and timestamp', async () => {
    const annotation = {
      message_id: '9de95ce2-070b-8b35-a8ae-03258307d0aa',
      message: 'Janela de atendimento iniciada',
      date: '2026-06-01T10:00:01.000Z',
    };
    const claimOperation = jest.fn(async () => ({
      status: 'duplicate' as const,
      state: 'succeeded' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-annotation-test',
      owner: null,
      result: {
        schema_version: 'official_whatsapp_send_recovery_v1',
        provider_result: {
          message_id: 'wamid.annotation',
          contact_wa_id: '5511999999999',
          message_status: 'accepted',
          raw: {},
        },
        update_message: null,
        message_status_update: null,
        schedule_status_update: null,
        annotation,
      },
    }));
    const {
      consumer,
      metaWhatsappEmbeddedService,
      chatMessageService,
      officialWindowService,
    } = makeConsumer({ claimOperation });

    await (consumer as any).processPayload(message, makeEnvelope());

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordProviderAcceptedMessage
    ).toHaveBeenCalledWith(message, 'wamid.annotation');
    expect(chatMessageService.publishPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: annotation.message_id,
        date: annotation.date,
        content: expect.objectContaining({
          type: EMessageType.annotation,
          message: annotation.message,
        }),
      }),
      undefined,
      expect.any(Function)
    );
  });

  it('releases a direct reservation when the Official connection preflight fails', async () => {
    const findActiveByWorkerId = jest.fn(async () => null);
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer({ findActiveByWorkerId });

    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).rejects.toThrow('official_whatsapp_connection_not_found');

    expect(findActiveByWorkerId).toHaveBeenCalledWith('worker-1');
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(
      messageSendIdempotencyService.releaseReservation
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markAmbiguous).not.toHaveBeenCalled();
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
  });

  it('keeps a direct pre-provider failure uncommitted when its terminal status cannot be applied', async () => {
    const {
      consumer,
      messageStatusService,
      messageSendIdempotencyService,
      metaWhatsappEmbeddedService,
    } = makeConsumer({
      findActiveByWorkerId: jest.fn(async () => null),
    });
    messageStatusService.markMessageAsNotSent.mockRejectedValueOnce(
      new Error('message storage unavailable')
    );

    await expect(
      (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
          assertActive: jest.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MessageUpdatePublishFailedError);

    expect(
      messageSendIdempotencyService.releaseReservation
    ).toHaveBeenCalledTimes(1);
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).not.toHaveBeenCalled();
    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).not.toHaveBeenCalled();
  });

  it('releases a scheduled reservation when content preflight fails', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const invalidMessage = {
      ...message,
      message_id: 'internal-message-invalid-content',
      hash: undefined,
      content: undefined,
    } as IChatMessage;
    const schedulePayload = {
      schedule_id: 'schedule-invalid-content',
      account_id: 'account-1',
      contact_id: 'contact-1',
      is_validated: true,
      message: invalidMessage,
    };
    const {
      consumer,
      metaWhatsappEmbeddedService,
      messageSendIdempotencyService,
    } = makeConsumer();

    try {
      await expect(
        (consumer as any).processPayload(
          schedulePayload,
          makeEnvelope(schedulePayload)
        )
      ).resolves.toBeUndefined();

      expect(
        messageSendIdempotencyService.markProviderInvoked
      ).not.toHaveBeenCalled();
      expect(
        messageSendIdempotencyService.releaseReservation
      ).toHaveBeenCalledTimes(1);
      expect(
        messageSendIdempotencyService.markAmbiguous
      ).not.toHaveBeenCalled();
      expect(
        metaWhatsappEmbeddedService.sendTemplateMessage
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('marks a timeout after provider invocation ambiguous and never sends it again', async () => {
    const providerTimeout = new Error('meta_timeout_after_invocation');
    const sendTemplateMessage = jest.fn(async () => {
      throw providerTimeout;
    });
    const acquiredClaim = {
      status: 'acquired' as const,
      state: 'reserved' as const,
      accountId: 'account-1',
      operationType: 'direct' as const,
      operationId: 'internal-message-1',
      key: 'message-send:idempotency:v3:official-timeout',
      owner: 'owner-timeout',
      result: null,
    };
    const claimOperation = jest
      .fn()
      .mockResolvedValueOnce(acquiredClaim)
      .mockResolvedValueOnce({
        ...acquiredClaim,
        status: 'duplicate' as const,
        state: 'ambiguous' as const,
        owner: null,
      });
    const { consumer, messageSendIdempotencyService } = makeConsumer({
      claimOperation,
      sendTemplateMessage,
    });

    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).rejects.toMatchObject({
      name: 'ScheduleMessageSendAmbiguousError',
      originalCause: providerTimeout,
    });
    await expect(
      (consumer as any).processPayload(message, makeEnvelope())
    ).resolves.toBeUndefined();

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(
      messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(messageSendIdempotencyService.markAmbiguous).toHaveBeenCalledWith(
      acquiredClaim,
      providerTimeout,
      expect.objectContaining({
        schema_version: 'message_send_ambiguous_terminal_v1',
        provider: 'official',
        operation_id: 'internal-message-1',
      })
    );
    expect(
      messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
  });
});
