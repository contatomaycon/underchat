import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@core/common/functions/startHeartbeat', () => ({
  startHeartbeat: jest.fn(() => jest.fn()),
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid?: string | null) => jid ?? undefined),
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

jest.mock('@core/services/attendanceInactivity.service', () => ({
  AttendanceInactivityService: class AttendanceInactivityService {},
}));

jest.mock('@core/services/activeWhatsappValidation.service', () => ({
  ActiveWhatsappValidationService: class ActiveWhatsappValidationService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/chatMessage.service', () => ({
  ChatMessageService: class ChatMessageService {},
}));

jest.mock('@core/services/chatbotFlowRunner.service', () => ({
  ChatbotFlowRunnerService: class ChatbotFlowRunnerService {},
}));

jest.mock('@core/services/contact.service', () => ({
  ContactService: class ContactService {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class EncryptService {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class PlanAccountService {},
}));

jest.mock('@core/services/pushNotification.service', () => ({
  PushNotificationService: class PushNotificationService {},
}));

jest.mock('@core/services/sector.service', () => ({
  SectorService: class SectorService {},
}));

jest.mock('@core/services/storage.service', () => ({
  StorageService: class StorageService {},
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('@core/config/environments', () => ({
  generalEnvironment: {
    automationSendDedupeTtlSeconds: 60,
  },
}));

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@core/plugins/telemetry/observability', () => ({
  incrementCounter: jest.fn(),
  recordException: jest.fn(),
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';

describe('MessageUpsertConsume edit fallback', () => {
  const account = { id: 'account-1', name: 'Account' };
  const worker = { id: 'worker-1', name: 'WWebJS' };
  const phoneJid = '556999715039@s.whatsapp.net';
  const lidJid = '6352894177535@lid';
  const targetMessageId = `false_${lidJid}_3A7E64CFE62F38192A29`;
  const editEventId = `edit_${targetMessageId}_1778190016147`;
  const adBody =
    'Olá! Gostaria de saber sobre a Pós-Graduação EAD com um atendimento humanizado!';
  const validationText = 'Código de Validação: ABCD-EF12-3456-WXYZ-UNDERCHAT';
  const ciphertextFallbackBody =
    'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';

  const makeChat = (): IChat =>
    ({
      chat_id: 'chat-1',
      account,
      worker,
      status: EChatStatus.queue,
      name: 'Luh',
      phone: {
        id: 'phone-1',
        phone: '6999715039',
        phone_ddi: '55',
      },
      user: null,
      sector: null,
      contact: null,
      photo: null,
      date: '2026-05-07T22:32:34.147Z',
    }) as unknown as IChat;

  const makeClosedChat = (): IChat =>
    ({
      ...makeChat(),
      chat_id: 'chat-closed',
      status: EChatStatus.closed,
      closed_at: '2026-05-08T10:00:00.000Z',
    }) as IChat;

  const makeExistingMessage = (): IChatMessage =>
    ({
      message_id: 'message-existing',
      chat_id: 'chat-1',
      message_key: {
        id: targetMessageId,
        remote_jid: phoneJid,
        remote_jid_alt: lidJid,
        from_me: false,
      },
      type_user: ETypeUserChat.client,
      account,
      worker,
      phone: makeChat().phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      content: {
        type: EMessageType.text,
        message: 'texto anterior',
      },
      date: '2026-05-07T22:32:34.147Z',
      deleted: false,
      has_quoted: false,
      hash: 'hash-1',
    }) as IChatMessage;

  const makeExistingCiphertextSystemMessage = (): IChatMessage =>
    ({
      ...makeExistingMessage(),
      type_user: ETypeUserChat.system,
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: true,
        is_sent_to_internal: true,
      },
      content: {
        type: EMessageType.system,
        message: ciphertextFallbackBody,
      },
    }) as IChatMessage;

  const makeTextUpsert = (
    body: string = adBody,
    options: { fromMe?: boolean; messageTimestamp?: number } = {}
  ): IUpsertMessage => ({
    account_id: 'account-1',
    worker_id: 'worker-1',
    source_provider: 'wwebjs',
    type: EMessageType.text,
    has_quoted: false,
    message: {
      key: {
        id: targetMessageId,
        remoteJid: phoneJid,
        remoteJidAlt: lidJid,
        fromMe: options.fromMe ?? false,
      },
      message: {
        conversation: body,
        extendedTextMessage: {
          text: body,
        },
      },
      messageTimestamp: options.messageTimestamp ?? 1778190016,
      pushName: 'Luh',
    },
  });

  const makeReactionUpsert = (input: {
    phone?: string;
    name?: string;
    messageId?: string;
    targetMessageId?: string | null;
    messageTimestamp?: number;
  }): IUpsertMessage => {
    const phone = input.phone ?? '556999715039';
    const remote = `${phone}@s.whatsapp.net`;
    const messageId =
      input.messageId ?? `false_${remote}_reaction-${phone.slice(-4)}`;
    const targetId =
      input.targetMessageId === undefined
        ? `false_${remote}_target-${phone.slice(-4)}`
        : input.targetMessageId;

    return {
      account_id: 'account-1',
      worker_id: 'worker-1',
      source_provider: 'wwebjs',
      type: EMessageType.react,
      has_quoted: false,
      message: {
        key: {
          id: messageId,
          remoteJid: remote,
          fromMe: false,
        },
        message: {
          reactionMessage: {
            key: targetId ? { id: targetId, remoteJid: remote } : undefined,
            text: '👍',
            senderTimestampMs: (input.messageTimestamp ?? 1778190016) * 1000,
          },
        },
        messageTimestamp: input.messageTimestamp ?? 1778190016,
        pushName: input.name ?? 'Luh',
      },
    };
  };

  const makeEditUpsert = (): IUpsertMessage => ({
    account_id: 'account-1',
    worker_id: 'worker-1',
    type: EMessageType.edit_text,
    has_quoted: false,
    message: {
      key: {
        id: editEventId,
        remoteJid: phoneJid,
        remoteJidAlt: lidJid,
        fromMe: false,
      },
      message: {
        protocolMessage: {
          key: {
            id: targetMessageId,
          },
          editedMessage: {
            conversation: adBody,
            extendedTextMessage: {
              text: adBody,
            },
          },
        },
      },
      messageTimestamp: 1778190016,
      pushName: 'Luh',
    },
  });

  const elasticHit = (message: IChatMessage) => ({
    hits: {
      hits: [
        {
          _source: message,
        },
      ],
    },
  });

  const emptyElasticResult = {
    hits: {
      hits: [],
    },
  };

  const queryHasExactMessageKeyId = (
    query: unknown,
    messageId: string
  ): boolean => {
    if (!query || typeof query !== 'object') {
      return false;
    }

    if (
      'term' in query &&
      query.term &&
      typeof query.term === 'object' &&
      (query.term as Record<string, unknown>)['message_key.id'] === messageId
    ) {
      return true;
    }

    return Object.values(query).some((value) => {
      if (Array.isArray(value)) {
        return value.some((item) => queryHasExactMessageKeyId(item, messageId));
      }

      return queryHasExactMessageKeyId(value, messageId);
    });
  };

  const makeConsumer = (selectResult: unknown = emptyElasticResult) => {
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
      eval: jest.fn(async () => 1),
      status: 'ready',
    };
    const chat = makeChat();
    const chatService = {
      createMessageIdempotent: jest.fn(async (..._args: unknown[]) => ({
        created: true,
        conflict: false,
        id: 'message-created',
      })),
      ensureProtocolForNewChat: jest.fn(async (chatInput: IChat) => chatInput),
      patchExistingMessageMissingFields: jest.fn(
        async (..._args: unknown[]) => undefined
      ),
      updateMessageChat: jest.fn(async (..._args: unknown[]) => undefined),
      updateChatSummaryAtomically: jest.fn(async (..._args: unknown[]) => true),
      updateChatUserAndSector: jest.fn(async (..._args: unknown[]) => true),
      findChatByChatId: jest.fn(async (..._args: unknown[]) => chat),
      findChatByPhone: jest.fn(async (..._args: unknown[]) => null),
      saveChat: jest.fn(async (..._args: unknown[]) => undefined),
      invalidateChatCache: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const accountService = {
      viewAccountName: jest.fn(async () => account),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => worker),
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({
        auto_save_contacts: false,
      })),
    };
    const userService = {
      viewUserNamePhoto: jest.fn(async (userId: string) => ({
        id: userId,
        name: userId === 'user-2' ? 'Target User' : 'Target Sector User',
        photo: null,
      })),
      listUserIdsWithAccessToChannel: jest.fn(async () => [
        'sector-user-1',
        'sector-user-2',
      ]),
    };
    const sectorService = {
      viewSectorById: jest.fn(async (sectorId: string) => ({
        sector_id: sectorId,
        name: 'Support Sector',
        color: '#0055ff',
      })),
    };
    const pushNotificationService = {
      sendNotificationForChatMessage: jest.fn(async () => undefined),
      sendNotificationForChatStatusChange: jest.fn(async () => undefined),
      sendNotificationForChatTransfer: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      select: jest.fn(async () => selectResult),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
      isReadOnlyAllowDeleteBlockError: jest.fn(() => false),
    };
    const activeWhatsappValidationService = {
      handleIncomingMessage: jest.fn(async () => false),
    };
    const workerConfigService = {
      viewWorkerConfig: jest.fn(async () => ({
        mark_as_read: false,
      })),
      viewChatbots: jest.fn(async () => ({
        enabled: false,
        chatbot_id: null,
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      })),
    };
    const chatbotFlowRunnerService = {
      canTriggerChatbotEvent: jest.fn(async () => false),
      clearFlowCacheForChat: jest.fn(async () => undefined),
      execute: jest.fn(async () => undefined),
    };
    const consumer = new MessageUpsertConsume(
      redis as never,
      {} as never,
      {
        upsertMessage: jest.fn(() => 'upsert-message'),
        markMessageRead: jest.fn(() => 'mark-message-read'),
        getNumPartitions: jest.fn(() => 1),
        getReplicationFactor: jest.fn(() => 1),
      } as never,
      elasticDatabaseService as never,
      accountService as never,
      workerService as never,
      chatService as never,
      {} as never,
      {
        publishSub: jest.fn(async () => ({})),
      } as never,
      {
        uploadFromUrl: jest.fn(async () => null),
        deleteImage: jest.fn(async () => undefined),
      } as never,
      {
        send: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {
        createContact: jest.fn(async () => null),
        getContactByPhone: jest.fn(async () => null),
        updateContactById: jest.fn(async () => undefined),
      } as never,
      workerConfigService as never,
      chatbotFlowRunnerService as never,
      {
        cancelInactivityTrackingForEndedAttendance: jest.fn(
          async () => undefined
        ),
        startTrackingOnInChatEntry: jest.fn(async () => undefined),
        resetOnContactMessage: jest.fn(async () => undefined),
        resetOnOperatorMessage: jest.fn(async () => undefined),
        resetOnOperatorAnnotationMessage: jest.fn(async () => undefined),
      } as never,
      {
        validateCanCreateContactReceived: jest.fn(async () => false),
      } as never,
      pushNotificationService as never,
      sectorService as never,
      userService as never,
      activeWhatsappValidationService as never
    );

    return {
      consumer,
      chat,
      chatService,
      userService,
      sectorService,
      pushNotificationService,
      elasticDatabaseService,
      activeWhatsappValidationService,
      workerConfigService,
      chatbotFlowRunnerService,
    };
  };

  it('delegates exact active WhatsApp validation messages before normal processing', async () => {
    const { consumer, activeWhatsappValidationService } = makeConsumer();
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValueOnce(
      true
    );

    const result = await (consumer as any).handleActiveWhatsappValidation(
      makeTextUpsert(validationText),
      '556999715039'
    );

    expect(result).toBe(true);
    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledWith({
      workerId: 'worker-1',
      fromPhone: '556999715039',
      messageText: validationText,
    });
  });

  it('ignores exact active WhatsApp validation messages sent by the operator', async () => {
    const { consumer, activeWhatsappValidationService } = makeConsumer();

    const result = await (consumer as any).handleActiveWhatsappValidation(
      makeTextUpsert(validationText, { fromMe: true }),
      '556999715039'
    );

    expect(result).toBe(false);
    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).not.toHaveBeenCalled();
  });

  it('does not consume similar active WhatsApp validation messages', async () => {
    const { consumer, activeWhatsappValidationService } = makeConsumer();
    const similarText = `Recebi o ${validationText}`;

    const result = await (consumer as any).handleActiveWhatsappValidation(
      makeTextUpsert(similarText),
      '556999715039'
    );

    expect(result).toBe(false);
    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledWith({
      workerId: 'worker-1',
      fromPhone: '556999715039',
      messageText: similarText,
    });
  });

  it('creates the original message when edit_text points to a missing target', async () => {
    const { consumer, chat, chatService } = makeConsumer();

    const result = await (consumer as any).createChatMessage(
      chat,
      makeEditUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.updateMessageChat).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);

    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.message_key).toEqual(
      expect.objectContaining({
        id: targetMessageId,
        remote_jid: phoneJid,
        remote_jid_alt: lidJid,
        from_me: false,
      })
    );
    expect(createdMessage.type_user).toBe(ETypeUserChat.client);
    expect(createdMessage.content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      })
    );
  });

  it('keeps normal edit behavior when the target message exists', async () => {
    const existingMessage = makeExistingMessage();
    const { consumer, chat, chatService } = makeConsumer(
      elasticHit(existingMessage)
    );

    const result = await (consumer as any).createChatMessage(
      chat,
      makeEditUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChat).toHaveBeenCalledTimes(1);

    const updatedMessage = chatService.updateMessageChat.mock
      .calls[0][0] as IChatMessage;
    expect(updatedMessage.message_id).toBe(existingMessage.message_id);
    expect(updatedMessage.content?.version).toEqual([
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      }),
    ]);
  });

  it('replaces a ciphertext system fallback when the real text arrives with the same key', async () => {
    const existingMessage = makeExistingCiphertextSystemMessage();
    const { consumer, chat, chatService } = makeConsumer(
      elasticHit(existingMessage)
    );

    const result = await (consumer as any).createChatMessage(
      chat,
      makeTextUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChat).toHaveBeenCalledTimes(1);

    const updatedMessage = chatService.updateMessageChat.mock
      .calls[0][0] as IChatMessage;
    expect(updatedMessage.message_id).toBe(existingMessage.message_id);
    expect(updatedMessage.type_user).toBe(ETypeUserChat.client);
    expect(updatedMessage.content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      })
    );
  });

  it('deduplicates an incoming message already stored in a closed chat before creating another chat', async () => {
    const closedChat = makeClosedChat();
    const existingMessage: IChatMessage = {
      ...makeExistingMessage(),
      chat_id: closedChat.chat_id,
      content: {
        type: EMessageType.text,
        message: adBody,
      },
    };
    const { consumer, chatService } = makeConsumer(elasticHit(existingMessage));
    chatService.findChatByChatId.mockImplementation(
      async (...args: unknown[]) =>
        args[1] === closedChat.chat_id ? closedChat : makeChat()
    );

    await (consumer as any).createOrUpdateChat(
      jest.fn(),
      makeTextUpsert(),
      '556999715039'
    );

    expect(chatService.findChatByPhone).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.patchExistingMessageMissingFields).toHaveBeenCalledWith(
      existingMessage.message_id,
      expect.objectContaining({
        chat_id: closedChat.chat_id,
      })
    );
  });

  it('applies an edit event to the original closed chat instead of creating a fresh chat', async () => {
    const closedChat = makeClosedChat();
    const existingMessage: IChatMessage = {
      ...makeExistingMessage(),
      chat_id: closedChat.chat_id,
    };
    const { consumer, chatService, elasticDatabaseService } =
      makeConsumer(emptyElasticResult);
    (elasticDatabaseService.select as jest.Mock).mockImplementation(
      async (...args: unknown[]) => {
        const query = args[1];
        return queryHasExactMessageKeyId(query, targetMessageId)
          ? elasticHit(existingMessage)
          : emptyElasticResult;
      }
    );
    chatService.findChatByChatId.mockImplementation(
      async (...args: unknown[]) =>
        args[1] === closedChat.chat_id ? closedChat : makeChat()
    );

    await (consumer as any).createOrUpdateChat(
      jest.fn(),
      makeEditUpsert(),
      '556999715039'
    );

    expect(chatService.findChatByPhone).toHaveBeenCalledTimes(1);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChat).toHaveBeenCalledTimes(1);

    const updatedMessage = chatService.updateMessageChat.mock
      .calls[0][0] as IChatMessage;
    expect(updatedMessage.chat_id).toBe(closedChat.chat_id);
    expect(updatedMessage.content?.version).toEqual([
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      }),
    ]);
  });

  it('does not execute chatbot flow for historical react payloads from the affected WWebJS contacts', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });

    try {
      const {
        consumer,
        chatService,
        workerConfigService,
        chatbotFlowRunnerService,
      } = makeConsumer();
      workerConfigService.viewChatbots.mockResolvedValue({
        enabled: true,
        chatbot_id: 'chatbot-input',
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      } as any);
      chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);

      const affectedReactions = [
        {
          name: 'Bruna - Gandrei - EX',
          phone: '554791258681',
          messageTimestamp: Math.floor(
            new Date('2026-05-07T13:57:00.000-03:00').getTime() / 1000
          ),
        },
        {
          name: 'Marcela - Arte Visual Grafica - EX',
          phone: '558532818181',
          messageTimestamp: Math.floor(
            new Date('2026-05-07T13:54:00.000-03:00').getTime() / 1000
          ),
        },
        {
          name: 'Ana - Passografic - 5.0',
          phone: '555496561299',
          messageTimestamp: Math.floor(
            new Date('2026-03-27T13:54:00.000-03:00').getTime() / 1000
          ),
        },
        {
          name: 'Julia - Xprint - EX',
          phone: '5519982360051',
          messageTimestamp: Math.floor(
            new Date('2026-03-27T13:54:00.000-03:00').getTime() / 1000
          ),
        },
        {
          name: 'Priscilla - Masao - 5.0',
          phone: '5511983908280',
          messageTimestamp: Math.floor(
            new Date('2026-03-27T14:03:00.000-03:00').getTime() / 1000
          ),
        },
        {
          name: 'Janaina - Ribergrafica - 5.0',
          phone: '5516997774378',
          messageTimestamp: Math.floor(
            new Date('2026-03-27T13:54:00.000-03:00').getTime() / 1000
          ),
        },
      ];

      for (const reaction of affectedReactions) {
        await (consumer as any).createOrUpdateChat(
          jest.fn((key: string) => key),
          makeReactionUpsert({
            ...reaction,
            messageId: `false_${reaction.phone}@s.whatsapp.net_reaction-${reaction.phone}`,
            targetMessageId: `false_${reaction.phone}@s.whatsapp.net_target-${reaction.phone}`,
          }),
          reaction.phone
        );
      }

      expect(
        chatbotFlowRunnerService.canTriggerChatbotEvent
      ).not.toHaveBeenCalled();
      expect(chatbotFlowRunnerService.execute).not.toHaveBeenCalled();
      expect(chatService.ensureProtocolForNewChat).not.toHaveBeenCalled();
      expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not create a new attendance for a fresh reaction without an existing chat', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });

    try {
      const {
        consumer,
        chatService,
        workerConfigService,
        chatbotFlowRunnerService,
      } = makeConsumer();
      workerConfigService.viewChatbots.mockResolvedValue({
        enabled: true,
        chatbot_id: 'chatbot-input',
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      } as any);
      chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);

      await (consumer as any).createOrUpdateChat(
        jest.fn((key: string) => key),
        makeReactionUpsert({
          messageTimestamp: Math.floor(Date.now() / 1000) - 30,
        }),
        '556999715039'
      );

      expect(
        chatbotFlowRunnerService.canTriggerChatbotEvent
      ).not.toHaveBeenCalled();
      expect(chatbotFlowRunnerService.execute).not.toHaveBeenCalled();
      expect(chatService.ensureProtocolForNewChat).not.toHaveBeenCalled();
      expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('queues but does not execute chatbot for a fresh reaction whose target message is missing', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });

    try {
      const {
        consumer,
        chat,
        chatService,
        workerConfigService,
        chatbotFlowRunnerService,
      } = makeConsumer();
      const uraChat = {
        ...chat,
        status: EChatStatus.ura,
      } as IChat;
      chatService.findChatByPhone.mockResolvedValueOnce(uraChat as any);
      chatService.findChatByChatId.mockResolvedValue(uraChat);
      workerConfigService.viewChatbots.mockResolvedValue({
        enabled: true,
        chatbot_id: 'chatbot-input',
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      } as any);
      chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);

      await (consumer as any).createOrUpdateChat(
        jest.fn((key: string) => key),
        makeReactionUpsert({
          messageTimestamp: Math.floor(Date.now() / 1000) - 30,
          targetMessageId: 'missing-target-message',
        }),
        '556999715039'
      );

      expect(
        chatbotFlowRunnerService.canTriggerChatbotEvent
      ).not.toHaveBeenCalled();
      expect(chatbotFlowRunnerService.execute).not.toHaveBeenCalled();
      expect(chatService.ensureProtocolForNewChat).not.toHaveBeenCalled();
      expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still executes chatbot flow for a fresh text message when configured', async () => {
    jest.useFakeTimers({
      now: new Date('2026-06-05T14:03:00.000Z'),
    });

    try {
      const { consumer, workerConfigService, chatbotFlowRunnerService } =
        makeConsumer();
      workerConfigService.viewChatbots.mockResolvedValue({
        enabled: true,
        chatbot_id: 'chatbot-input',
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      } as any);
      chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);

      const data = makeTextUpsert('quero atendimento', {
        messageTimestamp: Math.floor(Date.now() / 1000) - 30,
      });

      await (consumer as any).createOrUpdateChat(
        jest.fn((key: string) => key),
        data,
        '556999715039'
      );

      expect(
        chatbotFlowRunnerService.canTriggerChatbotEvent
      ).toHaveBeenCalledWith(data, 'account-1', 'chatbot-input');
      expect(chatbotFlowRunnerService.execute).toHaveBeenCalledTimes(1);
      expect(chatbotFlowRunnerService.execute).toHaveBeenCalledWith(
        expect.any(Function),
        data,
        expect.objectContaining({
          status: EChatStatus.ura,
        }),
        'chatbot-input'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends a transfer push when message upsert transfers the chat to a user', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();

    await (consumer as any).transferToUser(jest.fn(), chat, {
      ...makeTextUpsert(),
      transfer_user_id: 'user-2',
    });

    expect(chatService.updateChatUserAndSector).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        id: 'user-2',
        name: 'Target User',
      }),
      null
    );
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: '',
        candidateUserIds: ['user-2'],
        targetUserName: 'Target User',
        targetSectorName: null,
        targetWorkerName: 'WWebJS',
        chat: expect.objectContaining({
          chat_id: 'chat-1',
          user: expect.objectContaining({ id: 'user-2' }),
          sector: null,
        }),
      })
    );
  });

  it('sends a transfer push to channel users when message upsert transfers only to a sector', async () => {
    const { consumer, chat, userService, pushNotificationService } =
      makeConsumer();

    await (consumer as any).transferToSector(jest.fn(), chat, {
      ...makeTextUpsert(),
      transfer_sector_id: 'sector-2',
    });

    expect(userService.listUserIdsWithAccessToChannel).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateUserIds: ['sector-user-1', 'sector-user-2'],
        targetUserName: null,
        targetSectorName: 'Support Sector',
        targetWorkerName: 'WWebJS',
        chat: expect.objectContaining({
          chat_id: 'chat-1',
          sector: expect.objectContaining({ id: 'sector-2' }),
        }),
      })
    );
  });

  it('sends a status push when a new queue chat is created from message upsert', async () => {
    const { consumer, chatService, pushNotificationService } = makeConsumer();
    const createdChat = {
      ...makeChat(),
      chat_id: 'uuid-v7',
      status: EChatStatus.queue,
    } as IChat;
    chatService.findChatByChatId.mockResolvedValue(createdChat);

    await (consumer as any).createOrUpdateChatQueue(
      jest.fn((key: string) => key),
      null,
      makeTextUpsert()
    );

    expect(
      pushNotificationService.sendNotificationForChatStatusChange
    ).toHaveBeenCalledWith(createdChat);
  });

  it('does not send a status push for historical message sync chat creation', async () => {
    const { consumer, pushNotificationService } = makeConsumer();

    await (consumer as any).notifyChatStatusChangeIfNeeded(null, makeChat(), {
      ...makeTextUpsert(),
      from_history_sync: true,
    });

    expect(
      pushNotificationService.sendNotificationForChatStatusChange
    ).not.toHaveBeenCalled();
  });
});
