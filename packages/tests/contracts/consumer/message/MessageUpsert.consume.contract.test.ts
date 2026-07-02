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
import { withLock } from '@core/common/functions/withLock';

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

  const makeButtonsUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    message: {
      ...makeTextUpsert('').message,
      message: {
        buttonsMessage: {
          contentText: 'Escolha uma opção',
          footerText: 'Underchat',
          headerType: 1,
          buttons: [
            {
              buttonId: '1',
              buttonText: { displayText: 'Atendimento' },
              type: 1,
            },
            {
              buttonId: '2',
              buttonText: { displayText: 'Financeiro' },
              type: 1,
            },
          ],
        },
      },
    },
  });

  const makeButtonsResponseUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    message: {
      ...makeTextUpsert('').message,
      message: {
        buttonsResponseMessage: {
          selectedDisplayText: 'Financeiro',
          selectedButtonId: '2',
        },
      },
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

  const makeNestedEditUpsert = (): IUpsertMessage => ({
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
        editedMessage: {
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

  const queryHasNestedPath = (query: unknown, path: string): boolean => {
    if (!query || typeof query !== 'object') {
      return false;
    }

    if (
      'nested' in query &&
      query.nested &&
      typeof query.nested === 'object' &&
      (query.nested as Record<string, unknown>).path === path
    ) {
      return true;
    }

    return Object.values(query).some((value) => {
      if (Array.isArray(value)) {
        return value.some((item) => queryHasNestedPath(item, path));
      }

      return queryHasNestedPath(value, path);
    });
  };

  const queryHasTerm = (
    query: unknown,
    field: string,
    expectedValue: unknown
  ): boolean => {
    if (!query || typeof query !== 'object') {
      return false;
    }

    if (
      'term' in query &&
      query.term &&
      typeof query.term === 'object' &&
      (query.term as Record<string, unknown>)[field] === expectedValue
    ) {
      return true;
    }

    return Object.values(query).some((value) => {
      if (Array.isArray(value)) {
        return value.some((item) => queryHasTerm(item, field, expectedValue));
      }

      return queryHasTerm(value, field, expectedValue);
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
      findChatByChatId: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => chat
      ),
      findChatByPhone: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => null
      ),
      findChatByMessageKeyJid: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => null
      ),
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
      listSectorUsersForTransfer: jest.fn(async () => [
        { id: 'sector-user-1' },
        { id: 'sector-user-2' },
        { id: 'sector-user-without-channel' },
      ]),
    };
    const pushNotificationService = {
      sendNotificationForChatMessage: jest.fn(async () => undefined),
      sendNotificationForChatStatusChange: jest.fn(async () => undefined),
      sendNotificationForChatTransfer: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      select: jest.fn<Promise<unknown>, [unknown, unknown]>(
        async () => selectResult
      ),
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
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const inboundMessageSpoolService = {
      startPublisher: jest.fn(() => undefined),
      publish: jest.fn(async () => true),
      parkConsumerMessage: jest.fn(async () => undefined),
    };
    const extractPhoneJidFromChat = (chatInput: IChat | null | undefined) => {
      const key = chatInput?.message_key;
      const fromKey = [key?.remote_jid, key?.remote_jid_alt].find(
        (candidate) =>
          typeof candidate === 'string' && candidate.endsWith('@s.whatsapp.net')
      );
      if (fromKey) {
        return fromKey;
      }

      return typeof chatInput?.phone === 'string'
        ? `${chatInput.phone.replaceAll(/\D/g, '')}@s.whatsapp.net`
        : null;
    };
    const lidJidCacheService = {
      isLidJid: jest.fn(
        (jid?: string | null) => jid?.endsWith('@lid') === true
      ),
      resolvePhoneJid: jest.fn(async () => null),
      remember: jest.fn(async () => null),
      rememberFromUpsert: jest.fn(async () => null),
      rememberFromChat: jest.fn(
        async (
          _accountId: string,
          _workerId: string,
          chatInput: IChat | null | undefined
        ) => extractPhoneJidFromChat(chatInput)
      ),
      extractPhoneJidFromChat: jest.fn(extractPhoneJidFromChat),
    };
    const storageService = {
      uploadFromUrl: jest.fn<Promise<any>, any[]>(async () => null),
      deleteImage: jest.fn(async () => undefined),
    };
    const contactService = {
      createContact: jest.fn<Promise<any>, any[]>(async () => null),
      getContactByPhone: jest.fn<Promise<any>, any[]>(async () => null),
      updateContactById: jest.fn(async () => undefined),
      updateContactIsValided: jest.fn(async () => undefined),
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
      storageService as never,
      streamProducerService as never,
      {} as never,
      contactService as never,
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
      activeWhatsappValidationService as never,
      inboundMessageSpoolService as never,
      lidJidCacheService as never
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
      streamProducerService,
      storageService,
      contactService,
      inboundMessageSpoolService,
      lidJidCacheService,
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

  it('preserves provider button messages as text content with button metadata', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeButtonsUpsert()
    ) as IChatMessage['content'];

    expect(content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: 'Escolha uma opção',
        buttons: expect.objectContaining({
          text: 'Escolha uma opção',
          footer: 'Underchat',
          header_type: 1,
          buttons: [
            {
              id: '1',
              display_text: 'Atendimento',
              type: 1,
            },
            {
              id: '2',
              display_text: 'Financeiro',
              type: 1,
            },
          ],
        }),
      })
    );
  });

  it('maps provider button response messages to selected text', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeButtonsResponseUpsert()
    ) as IChatMessage['content'];

    expect(content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: 'Financeiro',
      })
    );
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

  it('discards messages without remote JID without publishing to Kafka', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const consoleSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const upsert = makeTextUpsert();
    delete (upsert.message.key as { remoteJid?: string }).remoteJid;
    delete (upsert.message.key as { remoteJidAlt?: string }).remoteJidAlt;

    try {
      const result = await (consumer as any).processKafkaUpsertOnce(
        jest.fn(),
        upsert,
        17,
        63533
      );

      expect(result).toBe(true);
      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageUpsert] Discarding terminal message:',
        expect.objectContaining({
          reason: 'missing_remote_jid',
          partition: 17,
          offset: 63533,
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('discards messages without valid phone without publishing to Kafka', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const consoleSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const upsert = makeTextUpsert();
    upsert.message.key.remoteJid = 'not-a-phone@s.whatsapp.net';
    delete (upsert.message.key as { remoteJidAlt?: string }).remoteJidAlt;

    try {
      const result = await (consumer as any).processKafkaUpsertOnce(
        jest.fn(),
        upsert,
        17,
        63534
      );

      expect(result).toBe(true);
      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageUpsert] Discarding terminal message:',
        expect.objectContaining({
          reason: 'missing_valid_phone',
          partition: 17,
          offset: 63534,
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('resolves LID-only incoming messages from an active chat message key', async () => {
    const { consumer, chatService } = makeConsumer();
    const chatWithResolvedJid = {
      ...makeChat(),
      phone: '556999715039',
      message_key: {
        remote_jid: phoneJid,
        remote_jid_alt: lidJid,
      },
    } as IChat;
    chatService.findChatByMessageKeyJid.mockResolvedValueOnce(
      chatWithResolvedJid
    );
    chatService.findChatByPhone.mockResolvedValueOnce(chatWithResolvedJid);

    const upsert = makeTextUpsert();
    upsert.message.key.remoteJid = lidJid;
    delete (upsert.message.key as { remoteJidAlt?: string }).remoteJidAlt;

    const result = await (consumer as any).processKafkaUpsertOnce(
      jest.fn((key: string) => key),
      upsert,
      17,
      63535
    );

    expect(result).toBe(true);
    expect(chatService.findChatByMessageKeyJid).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      lidJid,
      undefined
    );
    expect(upsert.message.key.remoteJid).toBe(lidJid);
    expect(upsert.message.key.remoteJidAlt).toBe(phoneJid);
    expect(chatService.findChatByPhone).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      '556999715039',
      lidJid,
      phoneJid
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('reuses an open chat in the same worker when incoming JIDs match an alternate identity', async () => {
    const { consumer, chat, chatService } = makeConsumer();
    const existingChat = {
      ...chat,
      chat_id: 'chat-existing',
      phone: '556999715039',
      message_key: {
        remote_jid: phoneJid,
        remote_jid_alt: lidJid,
      },
    } as IChat;
    const data = makeTextUpsert('mesmo chat');
    data.message.key.remoteJid = lidJid;
    data.message.key.remoteJidAlt = phoneJid;
    chatService.findChatByPhone.mockResolvedValueOnce(existingChat);
    const withLockMock = jest.mocked(withLock);
    withLockMock.mockClear();

    await (consumer as any).createOrUpdateChat(
      jest.fn((key: string) => key),
      data,
      '556999715039'
    );

    expect(withLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'chat-create:account-1:worker-1:phone%3A556999715039',
      expect.any(Function),
      { ttlMs: 60_000, retryMs: 100, maxWaitMs: 90_000 }
    );
    expect(chatService.findChatByPhone).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      '556999715039',
      lidJid,
      phoneJid
    );
    expect(chatService.ensureProtocolForNewChat).not.toHaveBeenCalled();
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);

    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.chat_id).toBe('chat-existing');
    expect(createdMessage.message_key).toEqual(
      expect.objectContaining({
        remote_jid: lidJid,
        remote_jid_alt: phoneJid,
      })
    );
  });

  it('uses an existing contact photo when creating an official chat without provider photo', async () => {
    const { consumer, chatService, contactService, storageService } =
      makeConsumer();
    const contactPhoto = 'https://cdn.test/contact-photo.jpg';
    contactService.getContactByPhone.mockResolvedValueOnce({
      contact_id: 'contact-1',
      name: 'Cliente Local',
      phone_partial: '999715039',
      phone_ddi: '55',
      photo: contactPhoto,
      is_valided: true,
      ignore: 'not_ignore',
      user: null,
      label_templates: [],
    });
    const data = {
      ...makeTextUpsert('Oi'),
      source_provider: 'official_whatsapp',
      photo: undefined,
    } as IUpsertMessage;

    const createdChat = (await (consumer as any).createChat(
      data,
      EChatStatus.queue
    )) as IChat;

    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(createdChat.photo).toBe(contactPhoto);
    expect(createdChat.contact?.photo).toBe(contactPhoto);
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        photo: contactPhoto,
        contact: expect.objectContaining({
          photo: contactPhoto,
        }),
      })
    );
  });

  it('keeps an official chat without photo when there is no local contact photo', async () => {
    const { consumer, storageService } = makeConsumer();
    const data = {
      ...makeTextUpsert('Oi'),
      source_provider: 'official_whatsapp',
      photo: undefined,
    } as IUpsertMessage;

    const createdChat = (await (consumer as any).createChat(
      data,
      EChatStatus.queue
    )) as IChat;

    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(createdChat.photo).toBeNull();
  });

  it('hydrates official contact card content from an existing local contact', async () => {
    const { consumer, chat, chatService, contactService } = makeConsumer();
    const contactPhoto = 'https://cdn.test/braian-photo.jpg';
    contactService.getContactByPhone.mockImplementation(
      async (_accountId: string, phone: string, phoneDdi: string | null) => {
        if (phone === '61991211783' && phoneDdi === '55') {
          return {
            contact_id: 'contact-braian',
            name: 'Braian',
            last_name: null,
            phone_partial: '****-1783',
            phone_ddi: '55',
            email_partial: null,
            photo: contactPhoto,
            is_valided: true,
            ignore: 'not_ignore',
            user: null,
            label_templates: [],
          };
        }

        return null;
      }
    );
    const data = {
      ...makeTextUpsert(''),
      source_provider: 'official_whatsapp',
      type: EMessageType.contact_card,
      message: {
        ...makeTextUpsert('').message,
        key: {
          id: 'wamid.contact-card',
          remoteJid: phoneJid,
          fromMe: false,
        },
        message: {
          contactMessage: {
            displayName: 'Braian',
            vcard:
              'BEGIN:VCARD\nVERSION:3.0\nN:;Braian;;;\nFN:Braian\nTEL;type=CELL;type=VOICE;waid=556191211783:+55 61 99121-1783\nEND:VCARD',
          },
        },
      },
      content: {
        type: EMessageType.contact_card,
        message: 'Braian',
        contact: {
          contact_id: null,
          name: 'Braian',
          last_name: null,
          phone: '556191211783',
          phone_partial: '556191211783',
          phone_ddi: '55',
          email: null,
          email_partial: null,
          photo: null,
        },
        contacts: null,
      },
    } as IUpsertMessage;

    await (consumer as any).createChatMessage(chat, data);

    expect(contactService.getContactByPhone).toHaveBeenCalledWith(
      'account-1',
      '61991211783',
      '55'
    );
    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.content).toEqual(
      expect.objectContaining({
        contact: expect.objectContaining({
          contact_id: 'contact-braian',
          name: 'Braian',
          phone: '61991211783',
          phone_ddi: '55',
          phone_partial: '****-1783',
          photo: contactPhoto,
        }),
      })
    );
  });

  it('syncs an existing chat photo from its contact when the chat has no photo', async () => {
    const { consumer, chat, chatService, storageService } = makeConsumer();
    const contactPhoto = 'https://cdn.test/existing-contact-photo.jpg';
    const existingChat = {
      ...chat,
      photo: null,
      contact: {
        id: 'contact-1',
        name: 'Cliente Local',
        phone: '999715039',
        phone_ddi: '55',
        photo: contactPhoto,
      },
    } as IChat;

    await (consumer as any).createChatMessage(
      existingChat,
      makeTextUpsert('Oi')
    );

    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(existingChat.photo).toBe(contactPhoto);
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: existingChat.chat_id,
        photo: contactPhoto,
      })
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('hydrates an existing official chat photo from a local contact when the chat has no linked contact', async () => {
    const { consumer, chat, chatService, contactService, storageService } =
      makeConsumer();
    const contactPhoto = 'https://cdn.test/local-contact-photo.jpg';
    const existingChat = {
      ...chat,
      photo: null,
      contact: null,
      phone: '556999715039',
    } as IChat;
    contactService.getContactByPhone.mockResolvedValueOnce({
      contact_id: 'contact-1',
      name: 'Cliente Local',
      phone_partial: '999715039',
      phone_ddi: '55',
      photo: contactPhoto,
      is_valided: true,
      ignore: 'not_ignore',
      user: null,
      label_templates: [],
    });
    const data = {
      ...makeTextUpsert('Oi'),
      source_provider: 'official_whatsapp',
      photo: undefined,
    } as IUpsertMessage;

    await (consumer as any).createChatMessage(existingChat, data);

    expect(contactService.getContactByPhone).toHaveBeenCalledWith(
      'account-1',
      '6999715039',
      '55'
    );
    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(existingChat.photo).toBe(contactPhoto);
    expect(existingChat.contact).toEqual(
      expect.objectContaining({
        id: 'contact-1',
        name: 'Cliente Local',
        photo: contactPhoto,
      })
    );
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: existingChat.chat_id,
        photo: contactPhoto,
        contact: expect.objectContaining({
          id: 'contact-1',
          photo: contactPhoto,
        }),
      })
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale official chat and embedded contact photos from the current local contact', async () => {
    const { consumer, chat, chatService, contactService, storageService } =
      makeConsumer();
    const oldPhoto = 'https://storage.test/old-contact-photo.jpg';
    const currentPhoto = 'https://storage.test/current-contact-photo.jpg';
    const existingChat = {
      ...chat,
      photo: oldPhoto,
      contact: {
        id: 'contact-1',
        name: 'Cliente Local',
        phone: '999715039',
        phone_ddi: '55',
        photo: oldPhoto,
      },
      phone: '556999715039',
    } as IChat;
    contactService.getContactByPhone.mockResolvedValueOnce({
      contact_id: 'contact-1',
      name: 'Cliente Local',
      phone_partial: '999715039',
      phone_ddi: '55',
      photo: currentPhoto,
      is_valided: true,
      ignore: 'not_ignore',
      user: null,
      label_templates: [],
    });
    const data = {
      ...makeTextUpsert('Oi'),
      source_provider: 'official_whatsapp',
      photo: undefined,
    } as IUpsertMessage;

    await (consumer as any).createChatMessage(existingChat, data);

    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(existingChat.photo).toBe(currentPhoto);
    expect(existingChat.contact?.photo).toBe(currentPhoto);
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: existingChat.chat_id,
        photo: currentPhoto,
        contact: expect.objectContaining({
          id: 'contact-1',
          photo: currentPhoto,
        }),
      })
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('does not replace an existing chat photo with the contact photo fallback', async () => {
    const { consumer, chat, chatService, storageService } = makeConsumer();
    const chatPhoto = 'https://storage.test/current-chat-photo.jpg';
    const contactPhoto = 'https://cdn.test/contact-photo.jpg';
    const existingChat = {
      ...chat,
      photo: chatPhoto,
      contact: {
        id: 'contact-1',
        name: 'Cliente Local',
        phone: '999715039',
        phone_ddi: '55',
        photo: contactPhoto,
      },
    } as IChat;

    await (consumer as any).createChatMessage(
      existingChat,
      makeTextUpsert('Oi')
    );

    expect(storageService.uploadFromUrl).not.toHaveBeenCalled();
    expect(existingChat.photo).toBe(chatPhoto);
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('keeps provider photo upload behavior for non-official upserts', async () => {
    const { consumer, chat, chatService, storageService } = makeConsumer();
    const providerPhoto = 'https://pps.whatsapp.net/provider-photo.jpg';
    const storedPhoto = 'https://storage.test/provider-photo.jpg';
    storageService.uploadFromUrl.mockResolvedValueOnce({
      url: storedPhoto,
      name: 'provider-photo.jpg',
      mimetype: 'image/jpeg',
      size: 1,
    });
    const data = {
      ...makeTextUpsert('Oi'),
      source_provider: 'wwebjs',
      photo: providerPhoto,
    } as IUpsertMessage;

    await (consumer as any).createChatMessage(chat, data);

    expect(storageService.uploadFromUrl).toHaveBeenCalledWith(
      providerPhoto,
      'account-1',
      chat.chat_id
    );
    expect(chat.photo).toBe(storedPhoto);
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: chat.chat_id,
        photo: storedPhoto,
      })
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('discards lock acquisition timeouts after local retries so the partition can commit', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const error = new Error(
      'Failed to acquire lock "chat-create:account-1:worker-1:556999715039" after 90000ms'
    );
    error.name = 'LockAcquisitionTimeoutError';

    try {
      const discarded = await (consumer as any).handleProcessRetry(
        makeTextUpsert(),
        17,
        63535,
        3,
        3,
        true,
        error
      );

      expect(discarded).toBeUndefined();
      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageUpsert] Discarding terminal message:',
        expect.objectContaining({
          reason: 'lock_acquisition_timeout',
          partition: 17,
          offset: 63535,
          retry_count: 3,
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
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
    expect(createdMessage.sent_from_platform).toBeUndefined();
    expect(createdMessage.content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      })
    );
  });

  it('marks a new own provider message as sent outside the platform', async () => {
    const { consumer, chat, chatService } = makeConsumer();

    const result = await (consumer as any).createChatMessage(
      chat,
      makeTextUpsert('Resposta pelo WhatsApp', { fromMe: true })
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);

    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.type_user).toBe(ETypeUserChat.operator);
    expect(createdMessage.message_key?.from_me).toBe(true);
    expect(createdMessage.sent_from_platform).toBe(false);
  });

  it('hydrates official quoted messages from the local message history', async () => {
    const existingMessage = makeExistingMessage();
    const officialMessageId =
      'wamid.HBgMNTU2MTk1OTk5MDQwFQIAEhgUM0FFQjlDMDAwNTdBM0NDRDdFRDYA';
    const { consumer, chat, chatService, elasticDatabaseService } =
      makeConsumer();
    elasticDatabaseService.select.mockImplementation(async (_index, query) =>
      queryHasExactMessageKeyId(query, targetMessageId)
        ? elasticHit(existingMessage)
        : emptyElasticResult
    );

    const upsert: IUpsertMessage = {
      ...makeTextUpsert('Teste'),
      source_provider: 'official_whatsapp',
      has_quoted: true,
      message: {
        ...makeTextUpsert('Teste').message,
        key: {
          ...makeTextUpsert('Teste').message.key,
          id: officialMessageId,
        },
      },
      content: {
        type: EMessageType.text,
        message: 'Teste',
        message_quoted_id: targetMessageId,
      },
    };

    const result = await (consumer as any).createChatMessage(chat, upsert);

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);

    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.has_quoted).toBe(true);
    expect(createdMessage.content?.message_quoted_id).toBe(targetMessageId);
    expect(createdMessage.content?.quoted).toEqual(
      expect.objectContaining({
        message: 'texto anterior',
        type: EMessageType.text,
        key: expect.objectContaining({
          id: targetMessageId,
          remote_jid: phoneJid,
          remote_jid_alt: lidJid,
          from_me: false,
        }),
      })
    );
  });

  it('hydrates official quoted messages when Meta sends a BR user wamid reference', async () => {
    const officialBrQuotedId =
      'wamid.HBgTQlIuMTAyMDcwMzI4MzgwMDI2MxUUABIYFDNBRUEyQTdEODVDRjk3QkMyREU2AA==';
    const officialPhoneQuotedId =
      'wamid.HBgMNTU2OTk5NzE1MDM5FQIAEhgUM0FFQTJBN0Q4NUNGOTdCQzJERTYA';
    const officialMessageId =
      'wamid.HBgMNTU2OTk5NzE1MDM5FQIAEhgUM0EzRkJEREE2OUIxNUMwNEJEMDMA';
    const existingMessage = {
      ...makeExistingMessage(),
      message_key: {
        ...makeExistingMessage().message_key,
        id: officialPhoneQuotedId,
        remote_jid: phoneJid,
        remote_jid_alt: lidJid,
      },
    } as IChatMessage;
    const { consumer, chat, chatService, elasticDatabaseService } =
      makeConsumer();
    elasticDatabaseService.select.mockImplementation(async (_index, query) =>
      queryHasExactMessageKeyId(query, officialPhoneQuotedId)
        ? elasticHit(existingMessage)
        : emptyElasticResult
    );

    const baseUpsert = makeTextUpsert('Teste');
    const upsert: IUpsertMessage = {
      ...baseUpsert,
      source_provider: 'official_whatsapp',
      has_quoted: true,
      message: {
        ...baseUpsert.message,
        key: {
          ...baseUpsert.message.key,
          id: officialMessageId,
        },
      },
      content: {
        type: EMessageType.text,
        message: 'Teste',
        message_quoted_id: officialBrQuotedId,
      },
    };

    const result = await (consumer as any).createChatMessage(chat, upsert);

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);

    const createdMessage = chatService.createMessageIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(createdMessage.has_quoted).toBe(true);
    expect(createdMessage.content?.message_quoted_id).toBe(officialBrQuotedId);
    expect(createdMessage.content?.quoted).toEqual(
      expect.objectContaining({
        message: 'texto anterior',
        type: EMessageType.text,
        key: expect.objectContaining({
          id: officialPhoneQuotedId,
          remote_jid: phoneJid,
          remote_jid_alt: lidJid,
          from_me: false,
        }),
      })
    );
  });

  it('keeps normal edit behavior when the target message exists', async () => {
    const existingMessage = makeExistingMessage();
    const { consumer, chat, chatService, elasticDatabaseService } =
      makeConsumer();
    elasticDatabaseService.select.mockImplementation(async (_index, query) =>
      queryHasTerm(query, 'worker.id', 'worker-1')
        ? elasticHit(existingMessage)
        : emptyElasticResult
    );

    const result = await (consumer as any).createChatMessage(
      chat,
      makeEditUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChat).toHaveBeenCalledTimes(1);
    const lookupQuery = elasticDatabaseService.select.mock.calls
      .map((call) => call[1])
      .find(
        (query) =>
          !queryHasNestedPath(query, 'worker') &&
          queryHasTerm(query, 'worker.id', 'worker-1')
      );
    expect(lookupQuery).toBeDefined();
    expect(queryHasNestedPath(lookupQuery, 'worker')).toBe(false);
    expect(queryHasTerm(lookupQuery, 'worker.id', 'worker-1')).toBe(true);

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

  it('keeps edit behavior when the protocol message is inside an editedMessage wrapper', async () => {
    const existingMessage = makeExistingMessage();
    const { consumer, chat, chatService, elasticDatabaseService } =
      makeConsumer();
    elasticDatabaseService.select.mockImplementation(async (_index, query) =>
      queryHasTerm(query, 'worker.id', 'worker-1')
        ? elasticHit(existingMessage)
        : emptyElasticResult
    );

    const result = await (consumer as any).createChatMessage(
      chat,
      makeNestedEditUpsert()
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
    const existingMessage = {
      ...makeExistingCiphertextSystemMessage(),
      sent_from_platform: true,
    };
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
    expect(updatedMessage.sent_from_platform).toBe(true);
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

  it('continues a transferred chatbot flow using chatbot_transfer_id', async () => {
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
      const transferredChat = {
        ...chat,
        status: EChatStatus.ura,
        chatbot_transfer_id: 'chatbot-transfer',
      } as IChat;

      chatService.findChatByPhone.mockResolvedValueOnce(transferredChat as any);
      workerConfigService.viewChatbots.mockResolvedValue({
        enabled: true,
        chatbot_id: 'chatbot-input',
        output_chatbot_id: null,
        chatbot_working_hours_enabled: false,
        chatbot_working_hours_rules: null,
        chatbot_working_hours_timezone: null,
      } as any);
      chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);

      const data = makeTextUpsert('continuar fluxo', {
        messageTimestamp: Math.floor(Date.now() / 1000) - 30,
      });

      await (consumer as any).createOrUpdateChat(
        jest.fn((key: string) => key),
        data,
        '556999715039'
      );

      expect(
        chatbotFlowRunnerService.canTriggerChatbotEvent
      ).toHaveBeenCalledWith(data, 'account-1', 'chatbot-transfer');
      expect(chatbotFlowRunnerService.execute).toHaveBeenCalledWith(
        expect.any(Function),
        data,
        transferredChat,
        'chatbot-transfer'
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

  it('sends a transfer push to sector users with channel access when message upsert transfers only to a sector', async () => {
    const {
      consumer,
      chat,
      userService,
      sectorService,
      pushNotificationService,
    } = makeConsumer();

    await (consumer as any).transferToSector(jest.fn(), chat, {
      ...makeTextUpsert(),
      transfer_sector_id: 'sector-2',
    });

    expect(userService.listUserIdsWithAccessToChannel).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(sectorService.listSectorUsersForTransfer).toHaveBeenCalledWith(
      'account-1',
      'sector-2'
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

  it('does not send a generic status push when a new queue chat is created from message upsert', async () => {
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
    ).not.toHaveBeenCalled();
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
