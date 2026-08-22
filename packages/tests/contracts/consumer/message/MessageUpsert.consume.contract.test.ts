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

jest.mock('@core/services/chatLifecycle.service', () => ({
  ChatLifecycleService: class ChatLifecycleService {},
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
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { IInboundMessageParkingPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';
import { withLock } from '@core/common/functions/withLock';
import {
  getKafkaDispatchGuard,
  runWithKafkaDispatchGuard,
} from '@core/common/functions/kafkaDispatchFenceContext';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

// This contract intentionally keeps the shared, high-fidelity consumer fixture
// beside its scenarios; splitting it would duplicate a large dependency graph.
// eslint-disable-next-line max-statements
describe('MessageUpsertConsume edit fallback', () => {
  const automationLeaseV2EnvName =
    'MESSAGE_UPSERT_AUTOMATION_SEND_LEASE_V2_ENABLED';
  const originalAutomationLeaseV2Env = process.env[automationLeaseV2EnvName];
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

  beforeEach(() => {
    process.env[automationLeaseV2EnvName] = 'true';
  });

  afterAll(() => {
    if (originalAutomationLeaseV2Env === undefined) {
      Reflect.deleteProperty(process.env, automationLeaseV2EnvName);
      return;
    }
    process.env[automationLeaseV2EnvName] = originalAutomationLeaseV2Env;
  });

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
          headerType: 'EMPTY',
          buttons: [
            {
              buttonId: '1',
              buttonText: { displayText: 'Atendimento' },
              type: 'RESPONSE',
            },
            {
              buttonId: '2',
              buttonText: { displayText: 'Financeiro' },
              type: 'RESPONSE',
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

  const makeListUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    message: {
      ...makeTextUpsert('').message,
      message: {
        listMessage: {
          description: 'Escolha uma opção',
          buttonText: 'Selecionar',
          listType: 'SINGLE_SELECT',
          sections: [
            {
              rows: [
                {
                  rowId: '1',
                  title: 'Endereço e finalizar',
                  description: 'Descrição da opção 1',
                },
                {
                  rowId: '2',
                  title: 'Opção 2',
                  description: 'Localização e Atendimento',
                },
              ],
            },
          ],
        },
      },
    },
  });

  const makeCtaUrlUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    message: {
      ...makeTextUpsert('').message,
      message: {
        interactiveMessage: {
          body: {
            text: 'Clique no link para abrir',
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Underchat',
                  url: 'https://underchat.com.br/',
                }),
              },
            ],
          },
        },
      },
    },
  });

  const makeTemplateUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    message: {
      ...makeTextUpsert('').message,
      verifiedBizName: 'Underchat',
      message: {
        templateMessage: {
          templateId: 'abertura',
          hydratedTemplate: {
            hydratedContentText:
              'Olá, tudo bem?\n\nEu sou da underchat, gostaria de conversar contigo.\nTem um momento?',
            hydratedButtons: [
              {
                urlButton: {
                  displayText: 'Qualquer dúvida',
                  url: 'https://underchat.com.br/',
                },
              },
            ],
          },
        },
      },
    },
  });

  const makeListResponseUpsert = (): IUpsertMessage => ({
    ...makeTextUpsert(''),
    source_provider: 'baileys',
    type: EMessageType.text,
    has_quoted: true,
    message: {
      ...makeTextUpsert('').message,
      message: {
        listResponseMessage: {
          title: 'Opção 2',
          description: 'Localização e Atendimento',
          singleSelectReply: {
            selectedRowId: '2',
          },
          contextInfo: {
            stanzaId: 'LIST_MESSAGE_ID',
            participant: '5500000000000@s.whatsapp.net',
            quotedMessage: {
              listMessage: {
                description: 'Escolha uma opção',
                buttonText: 'Selecionar',
                listType: 'SINGLE_SELECT',
                sections: [
                  {
                    rows: [
                      {
                        rowId: '2',
                        title: 'Opção 2',
                        description: 'Localização e Atendimento',
                      },
                    ],
                  },
                ],
              },
            },
          },
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

  const makeDeleteUpsert = (
    eventId = `delete_${targetMessageId}_1778190016147`
  ): IUpsertMessage => ({
    account_id: 'account-1',
    worker_id: 'worker-1',
    source_provider: 'wwebjs',
    type: EMessageType.delete_message,
    has_quoted: false,
    message: {
      key: {
        id: eventId,
        remoteJid: phoneJid,
        remoteJidAlt: lidJid,
        fromMe: false,
      },
      message: {
        protocolMessage: {
          key: {
            id: targetMessageId,
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
      get: jest.fn<Promise<string | null>, unknown[]>(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
      eval: jest.fn<Promise<unknown>, unknown[]>(async (script: unknown) => {
        const scriptText = String(script);
        if (scriptText.includes('automation_send_acquire_legacy_reader_v2')) {
          return 'acquired';
        }
        if (scriptText.includes('automation_send_acquire_v2')) {
          return 'acquired';
        }
        if (
          scriptText.includes('automation_send_heartbeat_v2') ||
          scriptText.includes('automation_send_complete_v2') ||
          scriptText.includes('automation_send_release_v2')
        ) {
          return 1;
        }
        return scriptText.includes("return {'acquired', 'reserved'}")
          ? ['acquired', 'reserved']
          : 'transitioned';
      }),
      status: 'ready',
    };
    const chat = makeChat();
    const chatService = {
      createMessageIdempotent: jest.fn(async (..._args: unknown[]) => ({
        created: true,
        conflict: false,
        id: 'message-created',
        attempted: true,
      })),
      ensureProtocolForNewChat: jest.fn(async (chatInput: IChat) => chatInput),
      patchExistingMessageMissingFields: jest.fn(
        async (..._args: unknown[]) => undefined
      ),
      updateMessageChat: jest.fn(async (..._args: unknown[]) => true),
      updateMessageChatIdempotent: jest.fn(async (..._args: unknown[]) => ({
        persisted: true,
        applied: true,
      })),
      updateChatSummaryAtomically: jest.fn(async (..._args: unknown[]) => true),
      updateChatUserAndSector: jest.fn(
        async (
          _chatId: string,
          user: IChat['user'] | null,
          sector: IChat['sector'] | null,
          assignmentEpoch?: number,
          assignmentEventId?: string
        ) => {
          chat.user = user;
          chat.sector = sector;
          chat.meta = {
            ...(chat.meta ?? {}),
            assignment_epoch: assignmentEpoch,
            assignment_event_id: assignmentEventId,
          };
          return true;
        }
      ),
      findChatByChatId: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => chat
      ),
      findChatByPhone: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => null
      ),
      findChatByMessageKeyJid: jest.fn<Promise<IChat | null>, unknown[]>(
        async (..._args: unknown[]) => null
      ),
      saveChat: jest.fn(async (..._args: unknown[]) => true),
      updateChatNameIfMissing: jest.fn(
        async (chatInput: IChat, name: string) => ({ ...chatInput, name })
      ),
      invalidateChatCache: jest.fn(async (..._args: unknown[]) => undefined),
      transferAutomationChatToQueue: jest.fn(
        async (input: {
          user?: IChat['user'] | null;
          sector?: IChat['sector'] | null;
          eventEpochMillis?: number;
          eventId?: string;
        }) => ({
          chat: {
            ...chat,
            status: EChatStatus.queue,
            user: input.user ?? null,
            sector: input.sector ?? null,
          } as IChat,
          previousChat: chat,
          applied: true,
          alreadyHuman: true,
        })
      ),
    };
    const chatMessageService = {
      sendMessage: jest.fn(async () => true),
    };
    const accountService = {
      viewAccountName: jest.fn(async () => account),
      viewAccountNameConsistent: jest.fn(async () => account),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => worker),
      viewWorkerNameAndIdConsistent: jest.fn(async () => worker),
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
      getById: jest.fn<Promise<IChatMessage | null>, unknown[]>(
        async (_index: unknown, messageId: unknown) => {
          const hits = (
            selectResult as {
              hits?: { hits?: Array<{ _source?: IChatMessage }> };
            }
          )?.hits?.hits;
          return (
            hits?.find((hit) => hit._source?.message_id === String(messageId))
              ?._source ?? null
          );
        }
      ),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
      isReadOnlyAllowDeleteBlockError: jest.fn(() => false),
    };
    const activeWhatsappValidationService = {
      parseValidationText: jest.fn((text?: string | null) => {
        const match = text?.match(/([A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}-UNDERCHAT)/);
        return match?.[1] ?? null;
      }),
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
      finishOutsideHoursChat: jest.fn(async () => true),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const inboundMessageSpoolService = {
      startPublisher: jest.fn(() => undefined),
      startMessageUpsertConsumerRedrive: jest.fn(() => undefined),
      stopMessageUpsertConsumerRedrive: jest.fn(async () => undefined),
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
    const centrifugoService = {
      publishSub: jest.fn(async (..._args: unknown[]) => ({})),
    };
    const attendanceInactivityService = {
      cancelInactivityTrackingForEndedAttendance: jest.fn(
        async () => undefined
      ),
      startTrackingOnInChatEntry: jest.fn(async () => undefined),
      resetOnContactMessage: jest.fn(async () => undefined),
      resetOnOperatorMessage: jest.fn(async () => undefined),
      resetOnOperatorAnnotationMessage: jest.fn(async () => undefined),
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
      chatMessageService as never,
      centrifugoService as never,
      storageService as never,
      streamProducerService as never,
      {} as never,
      contactService as never,
      workerConfigService as never,
      chatbotFlowRunnerService as never,
      attendanceInactivityService as never,
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
      accountService,
      workerService,
      chatService,
      chatMessageService,
      centrifugoService,
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
      attendanceInactivityService,
      redis,
    };
  };

  const installAutomationLeaseState = (
    redis: ReturnType<typeof makeConsumer>['redis']
  ) => {
    const values = new Map<string, string>();
    const ttls = new Map<string, number>();

    redis.eval.mockImplementation(async (...input: unknown[]) => {
      const [script, rawKeyCount, ...keyAndArgs] = input;
      const scriptText = String(script);
      const keyCount = Number(rawKeyCount);
      const keys = keyAndArgs.slice(0, keyCount).map(String);
      const args = keyAndArgs.slice(keyCount);

      if (scriptText.includes('automation_send_acquire_legacy_reader_v2')) {
        const [completionKey, leaseKey] = keys;
        if (values.has(completionKey)) {
          return 'completed';
        }
        if (values.has(leaseKey)) {
          return 'in_progress';
        }
        values.set(completionKey, String(args[0]));
        ttls.set(completionKey, Number(args[1]));
        return 'acquired';
      }

      if (scriptText.includes('automation_send_acquire_v2')) {
        const [completionKey, leaseKey] = keys;
        const ownerValue = String(args[0]);
        const processingTtl = Number(args[1]);
        if (values.has(completionKey)) {
          return 'completed';
        }
        const current = values.get(leaseKey);
        if (current === undefined) {
          values.set(leaseKey, ownerValue);
          ttls.set(leaseKey, processingTtl);
          return 'acquired';
        }
        return 'in_progress';
      }

      if (scriptText.includes('automation_send_heartbeat_v2')) {
        const [leaseKey] = keys;
        if (values.get(leaseKey) !== String(args[0])) {
          return 0;
        }
        ttls.set(leaseKey, Number(args[1]));
        return 1;
      }

      if (scriptText.includes('automation_send_complete_v2')) {
        const [completionKey, leaseKey] = keys;
        if (values.get(leaseKey) !== String(args[0])) {
          return 0;
        }
        if (!values.has(completionKey)) {
          values.set(completionKey, String(args[1]));
          ttls.set(completionKey, Number(args[2]));
        }
        values.delete(leaseKey);
        ttls.delete(leaseKey);
        return 1;
      }

      if (scriptText.includes('automation_send_release_v2')) {
        const [leaseKey] = keys;
        if (values.get(leaseKey) !== String(args[0])) {
          return 0;
        }
        values.delete(leaseKey);
        ttls.delete(leaseKey);
        return 1;
      }

      return 'transitioned';
    });

    return { values, ttls };
  };

  it('defaults the gate off while using a v2-aware atomic legacy SET NX writer', async () => {
    Reflect.deleteProperty(process.env, automationLeaseV2EnvName);
    const { consumer, redis } = makeConsumer();
    const subject = consumer as any;
    const sourceEvent = {
      ...makeTextUpsert('Gate default'),
      event_id: 'waevt_v1_gate-default-legacy',
    };

    expect(subject.AUTOMATION_SEND_LEASE_V2_ENABLED).toBe(false);
    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'chatbot_flow')
    ).resolves.toEqual({ status: 'acquired', protocol: 'legacy' });
    const legacyAcquireCall = redis.eval.mock.calls.find(([script]) =>
      String(script).includes('automation_send_acquire_legacy_reader_v2')
    );
    expect(legacyAcquireCall).toEqual([
      expect.stringContaining("'NX'"),
      2,
      expect.stringMatching(/^automation-send:idempotency:v1:/u),
      expect.stringMatching(/^automation-send:processing:v2:/u),
      '1',
      60,
    ]);
    expect(redis.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/^automation-send:idempotency:v1:/u),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(
      redis.eval.mock.calls.some(([script]) =>
        String(script).includes('automation_send_acquire_v2')
      )
    ).toBe(false);
  });

  it('parses only explicit true-like values as enabling the optional v2 lease gate', () => {
    for (const enabledValue of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env[automationLeaseV2EnvName] = enabledValue;
      expect(
        (makeConsumer().consumer as any).AUTOMATION_SEND_LEASE_V2_ENABLED
      ).toBe(true);
    }

    for (const disabledValue of ['0', 'false', 'no', 'off', 'invalid', '']) {
      process.env[automationLeaseV2EnvName] = disabledValue;
      expect(
        (makeConsumer().consumer as any).AUTOMATION_SEND_LEASE_V2_ENABLED
      ).toBe(false);
    }
  });

  it('uses separate v1 completion and v2 processing keys only when the gate is enabled', async () => {
    process.env[automationLeaseV2EnvName] = 'true';
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Gate v2'),
      event_id: 'waevt_v1_gate-enabled-v2',
    };
    const acquired = await (consumer as any).acquireAutomationSendAttempt(
      sourceEvent,
      'chatbot_flow'
    );

    expect(acquired).toEqual(
      expect.objectContaining({ status: 'acquired', protocol: 'lease_v2' })
    );
    expect(leaseState.values.has(acquired.claim.completionKey)).toBe(false);
    expect(leaseState.values.get(acquired.claim.leaseKey)).toBe(
      acquired.claim.ownerValue
    );
    expect(redis.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/^automation-send:idempotency:v1:/u),
      '1',
      'EX',
      60,
      'NX'
    );
  });

  it('lets a false-mode reader observe v2 processing when true mode wins first', async () => {
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const subject = consumer as any;
    const sourceEvent = {
      ...makeTextUpsert('True vence primeiro'),
      event_id: 'waevt_v1_gate-race-true-first',
    };

    subject.AUTOMATION_SEND_LEASE_V2_ENABLED = true;
    const v2Attempt = await subject.acquireAutomationSendAttempt(
      sourceEvent,
      'chatbot_flow'
    );
    subject.AUTOMATION_SEND_LEASE_V2_ENABLED = false;

    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'chatbot_flow')
    ).rejects.toThrow('already in progress');
    expect(leaseState.values.has(v2Attempt.claim.completionKey)).toBe(false);
    expect(leaseState.values.get(v2Attempt.claim.leaseKey)).toBe(
      v2Attempt.claim.ownerValue
    );
  });

  it('documents the ambiguous v1 marker seen by true mode when false mode acquires first', async () => {
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const subject = consumer as any;
    const sourceEvent = {
      ...makeTextUpsert('False vence primeiro'),
      event_id: 'waevt_v1_gate-race-false-first',
    };

    subject.AUTOMATION_SEND_LEASE_V2_ENABLED = false;
    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'outside_hours')
    ).resolves.toEqual({ status: 'acquired', protocol: 'legacy' });
    subject.AUTOMATION_SEND_LEASE_V2_ENABLED = true;

    // v1 cannot say whether the false-mode writer has completed its effect.
    // This is why enabling true requires a drained, all-at-once restart.
    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'outside_hours')
    ).resolves.toEqual({ status: 'completed' });
    expect(
      [...leaseState.values.entries()].filter(([key]) =>
        key.startsWith('automation-send:idempotency:v1:')
      )
    ).toEqual([[expect.any(String), '1']]);
    expect(
      [...leaseState.values.keys()].some((key) =>
        key.startsWith('automation-send:processing:v2:')
      )
    ).toBe(false);
  });

  it('does not hide an account-channel realtime publication failure', async () => {
    const { consumer, chat, centrifugoService } = makeConsumer();
    centrifugoService.publishSub
      .mockRejectedValueOnce(new Error('account channel unavailable'))
      .mockResolvedValueOnce({});

    await expect(
      (consumer as any).centrifugoChatQueuePublish(chat)
    ).rejects.toThrow('account channel unavailable');
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
  });

  it('discards managed-provider events without the active runtime fence', async () => {
    const { consumer } = makeConsumer();
    const processMessageWithLifecycle = jest.fn(async () => undefined);
    (
      consumer as unknown as {
        processMessageWithLifecycle: typeof processMessageWithLifecycle;
      }
    ).processMessageWithLifecycle = processMessageWithLifecycle;
    const assertActive = jest.fn();

    await (
      consumer as unknown as {
        processKafkaMessageInPartition: (
          t: unknown,
          topic: string,
          data: IUpsertMessage,
          partition: number,
          offset: number,
          context: unknown
        ) => Promise<void>;
      }
    ).processKafkaMessageInPartition(
      jest.fn(),
      'upsert.message',
      makeTextUpsert('Olá'),
      0,
      10,
      { assertActive } as never
    );

    expect(assertActive).toHaveBeenCalledTimes(1);
    expect(processMessageWithLifecycle).not.toHaveBeenCalled();
  });

  it('processes only the event matching the active runtime and connection epoch', async () => {
    const { consumer, redis } = makeConsumer();
    const processMessageWithLifecycle = jest.fn(async () => undefined);
    (
      consumer as unknown as {
        processMessageWithLifecycle: typeof processMessageWithLifecycle;
      }
    ).processMessageWithLifecycle = processMessageWithLifecycle;
    const assertActive = jest.fn();
    const data = {
      ...makeTextUpsert('Olá'),
      runtime_generation: 7,
      connection_epoch: 'epoch-current',
    };
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        worker_id: data.worker_id,
        runtime_generation: 7,
        connection_epoch: 'epoch-current',
        connection_sequence: 1,
        source_provider: 'wwebjs',
        activated_at: Date.now(),
        state: 'active',
        activation_order: 1,
      })
    );

    await (
      consumer as unknown as {
        processKafkaMessageInPartition: (
          t: unknown,
          topic: string,
          input: IUpsertMessage,
          partition: number,
          offset: number,
          context: unknown
        ) => Promise<void>;
      }
    ).processKafkaMessageInPartition(jest.fn(), 'upsert.message', data, 0, 11, {
      assertActive,
    } as never);

    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(processMessageWithLifecycle).toHaveBeenCalledTimes(1);
  });

  it('discards the event before a later effect when its connection epoch is replaced without a Kafka rebalance', async () => {
    const { consumer, redis } = makeConsumer();
    const effect = jest.fn(async () => undefined);
    const processMessageWithLifecycle = jest.fn(async () => {
      const assertEventActive = getKafkaDispatchGuard();
      expect(assertEventActive).toBeDefined();
      await assertEventActive?.();
      await effect();
    });
    (
      consumer as unknown as {
        processMessageWithLifecycle: typeof processMessageWithLifecycle;
      }
    ).processMessageWithLifecycle = processMessageWithLifecycle;
    const assertActive = jest.fn();
    const data = {
      ...makeTextUpsert('Olá'),
      runtime_generation: 7,
      connection_epoch: 'epoch-current',
    };
    redis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          worker_id: data.worker_id,
          runtime_generation: 7,
          connection_epoch: 'epoch-current',
          connection_sequence: 1,
          source_provider: 'wwebjs',
          activated_at: Date.now(),
          state: 'active',
          activation_order: 1,
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          worker_id: data.worker_id,
          runtime_generation: 8,
          connection_epoch: 'epoch-replacement',
          connection_sequence: 2,
          source_provider: 'whatsmeow',
          activated_at: Date.now() + 1,
          state: 'active',
          activation_order: 2,
        })
      );

    await expect(
      (
        consumer as unknown as {
          processKafkaMessageInPartition: (
            t: unknown,
            topic: string,
            input: IUpsertMessage,
            partition: number,
            offset: number,
            context: unknown
          ) => Promise<void>;
        }
      ).processKafkaMessageInPartition(
        jest.fn(),
        'upsert.message',
        data,
        0,
        12,
        { assertActive } as never
      )
    ).resolves.toBeUndefined();

    expect(processMessageWithLifecycle).toHaveBeenCalledTimes(1);
    expect(effect).not.toHaveBeenCalled();
    expect(assertActive).toHaveBeenCalledTimes(3);
  });

  it('binds an automatically created inbound contact to its origin channel', async () => {
    const { consumer, contactService } = makeConsumer();
    const data = makeTextUpsert('Olá');
    contactService.createContact.mockResolvedValueOnce('contact-created');
    contactService.getContactByPhone.mockResolvedValueOnce({
      contact_id: 'contact-created',
    });
    Object.assign(consumer, {
      planAccountService: {
        validateCanCreateContactReceived: jest.fn(async () => true),
      },
    });

    await expect(
      (
        consumer as unknown as {
          createContactAutomatically(
            input: IUpsertMessage,
            phoneAndDdi: { phone: string; phone_ddi: string | null },
            contactName: string
          ): Promise<unknown>;
        }
      ).createContactAutomatically(
        data,
        { phone: '61999999040', phone_ddi: '55' },
        'Maycon Douglas'
      )
    ).resolves.toEqual({ contact_id: 'contact-created' });

    expect(contactService.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [data.worker_id],
      }),
      data.account_id,
      true,
      undefined,
      expect.objectContaining({
        source: data.source_provider,
        originChannelId: data.worker_id,
        changes: { origin: 'inbound_message' },
      }),
      null
    );
  });

  describe('official inbound contact provenance', () => {
    it('persists official messages with the original Meta event time', () => {
      const { consumer } = makeConsumer();
      const data = {
        ...makeTextUpsert('Olá'),
        source_provider: 'official_whatsapp' as const,
        source_received_at: '2026-08-16T17:24:05.100Z',
        message: {
          ...makeTextUpsert('Olá').message,
          messageTimestamp: 1786800363,
        },
      };

      expect((consumer as any).resolvePersistedMessageDate(data)).toBe(
        '2026-08-15T13:26:03.000Z'
      );
    });

    it('recovers the original Meta event time from raw official content when envelope provenance was lost', () => {
      const { consumer } = makeConsumer();
      const base = makeTextUpsert('Olá');
      const messageId =
        'wamid.HBgNNTUxMTk3ODg5OTY1OBUCABIYFjNFQjA4NDYwNTM4NzA3RkJCMkM2OEQA';
      const data: IUpsertMessage = {
        ...base,
        source_provider: undefined,
        source_received_at: '2026-08-17T22:45:50.273Z',
        message: {
          ...base.message,
          messageTimestamp: undefined,
          key: {
            ...base.message.key,
            id: messageId,
          },
        },
        content: {
          type: EMessageType.text,
          message: 'Olá',
          official: {
            provider: 'meta_whatsapp',
            type: 'text',
            message_id: messageId,
            raw: {
              id: messageId,
              timestamp: '1784667417',
            },
          },
        },
      };

      expect((consumer as any).resolvePersistedMessageDate(data)).toBe(
        '2026-07-21T20:56:57.000Z'
      );
      expect((consumer as any).getUpsertMessageTimestampMs(data)).toBe(
        1784667417000
      );
    });

    it('lets Redis-admitted official redrives bypass Meta timestamp age', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const { consumer, inboundMessageSpoolService } = makeConsumer();
        const normalProcessing = jest
          .spyOn(consumer as any, 'processWithRetry')
          .mockResolvedValue(undefined);
        const base = makeTextUpsert('Todos usuarios e eu foram desconectados');
        const messageId =
          'wamid.HBgMNTU0OTk5OTIwNjEwFQIAEhgWM0VCMDFBNkM4RTM4OENFNjhBOUMwNAA=';
        const data: IUpsertMessage = {
          ...base,
          source_provider: undefined,
          source_received_at: '2026-08-17T22:45:50.273Z',
          consumer_redrive_attempt: 1,
          message: {
            ...base.message,
            messageTimestamp: undefined,
            key: {
              ...base.message.key,
              id: messageId,
            },
          },
          content: {
            type: EMessageType.text,
            message: 'Todos usuarios e eu foram desconectados',
            official: {
              provider: 'meta_whatsapp',
              type: 'text',
              message_id: messageId,
              raw: {
                id: messageId,
                timestamp: '1786121019',
              },
            },
          },
        };

        await expect(
          (consumer as any).processKafkaUpsertOnce(
            jest.fn((key: string) => key),
            data,
            4,
            812
          )
        ).resolves.toBe(true);

        expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual(
          expect.objectContaining({
            isOfficialInbound: true,
            discard: true,
            reason: 'official_stale_consumer_redrive',
            providerTimestampMs: 1786121019000,
            ageMs: expect.any(Number),
          })
        );
        expect(normalProcessing).toHaveBeenCalledTimes(1);
        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('uses the older raw Meta timestamp when a replay rebuilt a recent envelope timestamp', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const {
          consumer,
          chatService,
          inboundMessageSpoolService,
          centrifugoService,
        } = makeConsumer();
        const base = makeTextUpsert('Atendimento', {
          messageTimestamp: Math.floor(
            new Date('2026-08-17T22:45:20.000Z').getTime() / 1000
          ),
        });
        const messageId =
          'wamid.HBgMNTU0MTg0OTk1MDc0FQIAEhgWM0VCMDFCOTUxNTRCNTNDQ0E5Mzk5RQA=';
        const data: IUpsertMessage = {
          ...base,
          source_provider: 'official_whatsapp',
          source_received_at: '2026-08-17T22:45:50.273Z',
          message: {
            ...base.message,
            key: {
              ...base.message.key,
              id: messageId,
            },
          },
          content: {
            type: EMessageType.text,
            message: 'Atendimento',
            official: {
              provider: 'meta_whatsapp',
              type: 'interactive',
              message_id: messageId,
              raw: {
                id: messageId,
                timestamp: '1786121099',
              },
            },
          },
        };

        await expect(
          (consumer as any).processKafkaUpsertOnce(
            jest.fn((key: string) => key),
            data,
            5,
            913
          )
        ).resolves.toBe(true);

        expect((consumer as any).getOfficialProviderTimestampMs(data)).toBe(
          1786121099000
        );
        expect((consumer as any).resolvePersistedMessageDate(data)).toBe(
          '2026-08-07T16:44:59.000Z'
        );
        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'official_stale_webhook_replay',
            raw_meta: expect.objectContaining({
              provider_timestamp: '2026-08-07T16:44:59.000Z',
            }),
          })
        );
        expect(chatService.findChatByPhone).not.toHaveBeenCalled();
        expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
        expect(centrifugoService.publishSub).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('fails closed at the exact 24-hour official-window boundary', () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.000Z'),
      });

      try {
        const { consumer } = makeConsumer();
        const data: IUpsertMessage = {
          ...makeTextUpsert('Limite de 24 horas', {
            messageTimestamp: Math.floor(
              new Date('2026-08-16T22:45:50.000Z').getTime() / 1000
            ),
          }),
          source_provider: 'official_whatsapp',
        };

        expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual(
          expect.objectContaining({
            isOfficialInbound: true,
            discard: true,
            reason: 'official_stale_webhook_replay',
            ageMs: 24 * 60 * 60 * 1000,
          })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not apply the inbound replay barrier to official outbound echoes', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const { consumer, chatService, inboundMessageSpoolService } =
          makeConsumer();
        const base = makeTextUpsert('Resposta externa', {
          fromMe: true,
          messageTimestamp: 1786121099,
        });
        const messageId =
          'wamid.HBgMNTU0MTg0OTk1MDc0FQIAERgUQ0UxOTQxOTcwNTk4NzIxRjEzQUYA';
        const data: IUpsertMessage = {
          ...base,
          source_provider: 'official_whatsapp',
          message: {
            ...base.message,
            key: {
              ...base.message.key,
              id: messageId,
              fromMe: true,
            },
          },
          content: {
            type: EMessageType.text,
            message: 'Resposta externa',
            official: {
              provider: 'meta_whatsapp',
              type: 'text',
              echo: true,
              message_id: messageId,
              raw: {
                id: messageId,
                timestamp: '1786121099',
              },
            },
          },
        };

        await (consumer as any).processKafkaUpsertOnce(
          jest.fn((key: string) => key),
          data,
          0,
          2
        );

        expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual({
          isOfficialInbound: false,
          discard: false,
          providerTimestampMs: null,
          ageMs: null,
        });
        expect(
          (consumer as any).classifyOfficialWhatsappReplay({
            ...data,
            message: {
              ...data.message,
              key: { ...data.message.key, fromMe: undefined },
            },
          })
        ).toEqual({
          isOfficialInbound: false,
          discard: false,
          providerTimestampMs: null,
          ageMs: null,
        });
        expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not trust a synthetic fresh envelope timestamp when the raw Meta timestamp is missing', async () => {
      const {
        consumer,
        chatService,
        centrifugoService,
        inboundMessageSpoolService,
      } = makeConsumer();
      const base = makeTextUpsert('Olá');
      const data: IUpsertMessage = {
        ...base,
        source_provider: 'official_whatsapp',
        source_received_at: new Date().toISOString(),
        message: {
          ...base.message,
          // Older webhook mappers filled this field with Date.now() when the
          // immutable Meta timestamp was absent.
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
        content: {
          type: EMessageType.text,
          message: 'Olá',
          official: {
            provider: 'meta_whatsapp',
            type: 'text',
            raw: {},
          },
        },
      };

      await (consumer as any).processKafkaUpsertOnce(
        jest.fn((key: string) => key),
        data,
        2,
        99
      );

      expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual(
        expect.objectContaining({
          isOfficialInbound: true,
          discard: true,
          reason: 'official_message_timestamp_missing',
          providerTimestampMs: null,
          ageMs: null,
        })
      );
      expect(
        inboundMessageSpoolService.parkConsumerMessage
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'official_message_timestamp_missing',
          stage: 'message_upsert.discard.terminal',
          partition: 2,
          offset: 99,
        })
      );
      expect(chatService.findChatByPhone).not.toHaveBeenCalled();
      expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
      expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    });

    it('terminally blocks an official inbound timestamp more than one minute in the future', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const {
          consumer,
          chatService,
          centrifugoService,
          inboundMessageSpoolService,
        } = makeConsumer();
        const futureTimestamp = Math.floor(
          new Date('2026-08-17T22:47:51.000Z').getTime() / 1000
        );
        const base = makeTextUpsert('Mensagem futura', {
          messageTimestamp: futureTimestamp,
        });
        const data: IUpsertMessage = {
          ...base,
          source_provider: 'official_whatsapp',
        };

        await expect(
          (consumer as any).processKafkaUpsertOnce(
            jest.fn((key: string) => key),
            data,
            7,
            311
          )
        ).resolves.toBe(true);

        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'official_message_timestamp_future',
            raw_meta: expect.objectContaining({
              provider_timestamp: '2026-08-17T22:47:51.000Z',
              age_ms: expect.any(Number),
            }),
          })
        );
        expect(chatService.findChatByPhone).not.toHaveBeenCalled();
        expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
        expect(centrifugoService.publishSub).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not apply the official replay barrier to an old non-official source', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const { consumer, chatService, inboundMessageSpoolService } =
          makeConsumer();
        const base = makeTextUpsert('Mensagem antiga do provider gerenciado', {
          messageTimestamp: 1786121019,
        });
        const messageId =
          'wamid.HBgMNTU0OTk5OTIwNjEwFQIAEhgWM0VCMDFBNkM4RTM4OENFNjhBOUMwNAA=';
        const data: IUpsertMessage = {
          ...base,
          source_provider: 'wwebjs',
          message: {
            ...base.message,
            key: {
              ...base.message.key,
              id: messageId,
            },
          },
          content: {
            type: EMessageType.text,
            message: 'Mensagem antiga do provider gerenciado',
            official: {
              provider: 'meta_whatsapp',
              type: 'text',
              message_id: messageId,
              raw: {
                id: messageId,
                timestamp: '1786121019',
              },
            },
          },
        };

        await (consumer as any).processKafkaUpsertOnce(
          jest.fn((key: string) => key),
          data,
          0,
          3
        );

        expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual({
          isOfficialInbound: false,
          discard: false,
          providerTimestampMs: null,
          ageMs: null,
        });
        expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps a recent official webhook eligible when only raw content carries the timestamp', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-17T22:45:50.273Z'),
      });

      try {
        const { consumer, chatService } = makeConsumer();
        const base = makeTextUpsert('Olá');
        const messageId =
          'wamid.HBgMNTU2MTkyNjM2NTg2FQIAEhgWM0VCMDhCMkJBNDA2QjNCMTkxRjcwRAA=';
        const data: IUpsertMessage = {
          ...base,
          source_provider: undefined,
          source_received_at: '2026-08-17T22:45:50.273Z',
          message: {
            ...base.message,
            messageTimestamp: undefined,
            key: {
              ...base.message.key,
              id: messageId,
            },
          },
          content: {
            type: EMessageType.text,
            message: 'Olá',
            official: {
              provider: 'meta_whatsapp',
              type: 'text',
              message_id: messageId,
              raw: {
                id: messageId,
                timestamp: String(
                  Math.floor(
                    new Date('2026-08-17T22:45:20.000Z').getTime() / 1000
                  )
                ),
              },
            },
          },
        };

        await (consumer as any).processKafkaUpsertOnce(
          jest.fn((key: string) => key),
          data,
          0,
          1
        );

        expect((consumer as any).classifyOfficialWhatsappReplay(data)).toEqual(
          expect.objectContaining({
            isOfficialInbound: true,
            discard: false,
            providerTimestampMs: new Date('2026-08-17T22:45:20.000Z').getTime(),
          })
        );
        expect(chatService.ensureProtocolForNewChat).toHaveBeenCalledTimes(1);
        expect(chatService.ensureProtocolForNewChat).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-08-17T22:45:20.000Z',
            summary: expect.objectContaining({
              last_date: '2026-08-17T22:45:20.000Z',
            }),
          })
        );
        expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
        const createdMessage = chatService.createMessageIdempotent.mock
          .calls[0][0] as IChatMessage;
        expect(createdMessage.date).toBe('2026-08-17T22:45:20.000Z');
      } finally {
        jest.useRealTimers();
      }
    });

    it('records official inbound provenance for an automatically created contact', async () => {
      const { consumer, contactService } = makeConsumer();
      const data = {
        ...makeTextUpsert('Olá'),
        source_provider: 'official_whatsapp' as const,
      };
      contactService.createContact.mockResolvedValueOnce('contact-created');
      contactService.getContactByPhone.mockResolvedValueOnce({
        contact_id: 'contact-created',
      });
      Object.assign(consumer, {
        planAccountService: {
          validateCanCreateContactReceived: jest.fn(async () => true),
        },
      });

      await (
        consumer as unknown as {
          createContactAutomatically(
            input: IUpsertMessage,
            phoneAndDdi: { phone: string; phone_ddi: string | null },
            contactName: string
          ): Promise<unknown>;
        }
      ).createContactAutomatically(
        data,
        { phone: '61999999040', phone_ddi: '55' },
        'Maycon Douglas'
      );

      expect(contactService.createContact).toHaveBeenCalledWith(
        expect.any(Object),
        data.account_id,
        true,
        undefined,
        expect.any(Object),
        'official_inbound'
      );
    });

    it('promotes official inbound provenance once for an existing contact', async () => {
      const { consumer, contactService } = makeConsumer();
      const data = {
        ...makeTextUpsert('Olá'),
        source_provider: 'official_whatsapp' as const,
      };
      const existingContact = {
        contact_id: 'contact-1',
        name: 'Maycon',
        is_valided: true,
        validation_origin: null,
        ignore: 'not_ignore',
        user: null,
        label_templates: [],
        phone_partial: '*****9040',
        phone_ddi: '55',
        photo: null,
      };
      contactService.getContactByPhone
        .mockResolvedValueOnce(existingContact)
        .mockResolvedValueOnce({
          ...existingContact,
          validation_origin: 'official_inbound',
        });

      const ensureContactForChat = (
        consumer as unknown as {
          ensureContactForChat(
            inputChatMessage: IChat,
            input: IUpsertMessage,
            phoneAndDdi: { phone: string; phone_ddi: string | null },
            phone: string,
            name: string
          ): Promise<unknown>;
        }
      ).ensureContactForChat.bind(consumer);

      await ensureContactForChat(
        {} as IChat,
        data,
        { phone: '61999999040', phone_ddi: '55' },
        '61999999040',
        'Maycon'
      );
      expect(contactService.updateContactIsValided).toHaveBeenCalledWith(
        'contact-1',
        true,
        undefined,
        undefined,
        'official_inbound'
      );

      contactService.updateContactIsValided.mockClear();
      await ensureContactForChat(
        {} as IChat,
        data,
        { phone: '61999999040', phone_ddi: '55' },
        '61999999040',
        'Maycon'
      );
      expect(contactService.updateContactIsValided).not.toHaveBeenCalled();
    });
  });

  it('does not infer device delivery for an outbound echo without an explicit ACK', () => {
    const { consumer } = makeConsumer();
    const withoutAck = makeTextUpsert('Outbound', { fromMe: true });
    const wwebjsDelivered = {
      ...withoutAck,
      message: { ...withoutAck.message, ack: 2 },
    } as IUpsertMessage;
    const baileysServerAck = {
      ...withoutAck,
      source_provider: 'baileys' as const,
      message: { ...withoutAck.message, status: 2 },
    } as IUpsertMessage;

    expect((consumer as any).buildOutgoingSummary(withoutAck)).toEqual(
      expect.objectContaining({ is_sent: true, is_delivered: false })
    );
    expect((consumer as any).buildOutgoingSummary(wwebjsDelivered)).toEqual(
      expect.objectContaining({ is_delivered: true, is_seen: false })
    );
    expect((consumer as any).buildOutgoingSummary(baileysServerAck)).toEqual(
      expect.objectContaining({ is_sent: true, is_delivered: false })
    );
  });

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

  it('consumes a reserved redelivery fail-closed when the handled outcome was not confirmed', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const normalProcessing = jest
      .spyOn(consumer as any, 'processWithRetry')
      .mockResolvedValue(undefined);
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValueOnce(
      true
    );
    redis.eval
      .mockReset()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce(['duplicate', 'reserved']);
    const data = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-crash',
    } as IUpsertMessage;

    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 2, 31)
    ).rejects.toThrow('active_whatsapp_validation_ledger_handled_error');
    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 2, 31)
    ).resolves.toBe(true);

    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledTimes(1);
    expect(normalProcessing).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous claim when the validation handler throws and consumes its redelivery', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const normalProcessing = jest
      .spyOn(consumer as any, 'processWithRetry')
      .mockResolvedValue(undefined);
    activeWhatsappValidationService.handleIncomingMessage.mockRejectedValueOnce(
      new Error('validation side effect crashed')
    );
    redis.eval
      .mockReset()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce(['duplicate', 'ambiguous']);
    const data = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-ambiguous',
    } as IUpsertMessage;

    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 3, 41)
    ).rejects.toThrow('validation side effect crashed');
    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 3, 41)
    ).resolves.toBe(true);

    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledTimes(1);
    expect(normalProcessing).not.toHaveBeenCalled();
    expect(redis.eval.mock.calls[1]).toEqual(
      expect.arrayContaining(['ambiguous'])
    );
  });

  it('does not enter normal processing unless a false validation releases its reservation by owner CAS', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const normalProcessing = jest
      .spyOn(consumer as any, 'processWithRetry')
      .mockResolvedValue(undefined);
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValueOnce(
      false
    );
    redis.eval
      .mockReset()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('owner_mismatch')
      .mockResolvedValueOnce(['duplicate', 'reserved']);
    const data = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-release-failed',
    } as IUpsertMessage;

    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 4, 51)
    ).rejects.toThrow(
      'active_whatsapp_validation_ledger_release_owner_mismatch'
    );
    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 4, 51)
    ).resolves.toBe(true);

    expect(normalProcessing).not.toHaveBeenCalled();
    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledTimes(1);
  });

  it('allows normal processing only after a false validation claim is released', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const normalProcessing = jest
      .spyOn(consumer as any, 'processWithRetry')
      .mockResolvedValue(undefined);
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValueOnce(
      false
    );
    redis.eval
      .mockReset()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('transitioned');
    const data = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-not-handled',
    } as IUpsertMessage;

    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 5, 61)
    ).resolves.toBe(true);

    expect(normalProcessing).toHaveBeenCalledTimes(1);
  });

  it('fails closed before validation and normal processing when the ledger claim is unavailable', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const normalProcessing = jest
      .spyOn(consumer as any, 'processWithRetry')
      .mockResolvedValue(undefined);
    redis.eval.mockReset().mockRejectedValueOnce(new Error('redis down'));
    const data = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-redis-down',
    } as IUpsertMessage;

    await expect(
      (consumer as any).processKafkaUpsertOnce(jest.fn(), data, 6, 71)
    ).rejects.toThrow('active_whatsapp_validation_ledger_claim_failed');

    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).not.toHaveBeenCalled();
    expect(normalProcessing).not.toHaveBeenCalled();
  });

  it('fails closed when a validation candidate has no stable event id', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    const data = makeTextUpsert(validationText);
    delete (data.message.key as { id?: string }).id;
    delete data.event_id;

    await expect(
      (consumer as any).handleActiveWhatsappValidation(data, '556999715039')
    ).rejects.toThrow('active_whatsapp_validation_event_id_missing');

    expect(redis.eval).not.toHaveBeenCalled();
    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).not.toHaveBeenCalled();
  });

  it('does not deduplicate equal validation content when event ids are distinct', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValue(
      true
    );
    const first = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-distinct-a',
    } as IUpsertMessage;
    const second = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-distinct-b',
      source_provider: 'baileys' as const,
    } as IUpsertMessage;

    await expect(
      (consumer as any).handleActiveWhatsappValidation(first, '556999715039')
    ).resolves.toBe(true);
    await expect(
      (consumer as any).handleActiveWhatsappValidation(second, '556999715039')
    ).resolves.toBe(true);

    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0][2]).not.toBe(redis.eval.mock.calls[2][2]);
  });

  it('shares the validation ledger across providers for the same event id', async () => {
    const { consumer, activeWhatsappValidationService, redis } = makeConsumer();
    activeWhatsappValidationService.handleIncomingMessage.mockResolvedValueOnce(
      true
    );
    redis.eval
      .mockReset()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce(['duplicate', 'handled']);
    const first = {
      ...makeTextUpsert(validationText),
      event_id: 'waevt_v1_validation-provider-neutral',
      source_provider: 'wwebjs' as const,
    } as IUpsertMessage;
    const second = {
      ...makeTextUpsert(validationText),
      event_id: first.event_id,
      source_provider: 'baileys' as const,
    } as IUpsertMessage;

    await expect(
      (consumer as any).handleActiveWhatsappValidation(first, '556999715039')
    ).resolves.toBe(true);
    await expect(
      (consumer as any).handleActiveWhatsappValidation(second, '556999715039')
    ).resolves.toBe(true);

    expect(
      activeWhatsappValidationService.handleIncomingMessage
    ).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][2]).toBe(redis.eval.mock.calls[2][2]);
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

  it('normalizes prebuilt button metadata before indexing', () => {
    const { consumer } = makeConsumer();
    const upsert = makeTextUpsert('Escolha uma opção');
    upsert.content = {
      buttons: {
        text: 'Escolha uma opção',
        footer: 'Underchat',
        header_type: 'EMPTY',
        buttons: [
          {
            id: '1',
            display_text: 'Atendimento',
            type: 'RESPONSE',
          },
        ],
      },
    } as IChatMessage['content'];

    const content = (consumer as any).buildMessageContent(
      upsert
    ) as IChatMessage['content'];

    expect(content?.buttons).toEqual(
      expect.objectContaining({
        header_type: 1,
        buttons: [
          {
            id: '1',
            display_text: 'Atendimento',
            type: 1,
          },
        ],
      })
    );
  });

  it('normalizes prebuilt quoted button metadata before indexing', () => {
    const { consumer } = makeConsumer();
    const upsert = makeTextUpsert('Atendimento');
    upsert.content = {
      quoted: {
        key: {
          id: 'quoted-buttons-id',
          remote_jid: '556999715039@s.whatsapp.net',
          remote_jid_alt: null,
          from_me: true,
          participant: null,
          participant_alt: null,
          addressing_mode: null,
          is_view_once: false,
        },
        type: EMessageType.text,
        message: 'Escolha uma opção',
        buttons: {
          text: 'Escolha uma opção',
          header_type: 'EMPTY',
          buttons: [
            {
              id: '1',
              display_text: 'Atendimento',
              type: 'RESPONSE',
            },
          ],
        },
      },
    } as IChatMessage['content'];

    const content = (consumer as any).buildMessageContent(
      upsert
    ) as IChatMessage['content'];

    expect(content?.quoted?.buttons).toEqual(
      expect.objectContaining({
        header_type: 1,
        buttons: [
          {
            id: '1',
            display_text: 'Atendimento',
            type: 1,
          },
        ],
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

  it('preserves provider list messages as official list display metadata', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeListUpsert()
    ) as IChatMessage['content'];

    expect(content).toMatchObject({
      type: EMessageType.text,
      message: 'Escolha uma opção',
      list: {
        text: 'Escolha uma opção',
        button_text: 'Selecionar',
        list_type: 1,
        sections: [
          {
            id: 'section-1',
            title: null,
            rows: [
              {
                id: '1',
                title: 'Endereço e finalizar',
                description: 'Descrição da opção 1',
              },
              {
                id: '2',
                title: 'Opção 2',
                description: 'Localização e Atendimento',
              },
            ],
          },
        ],
      },
      official: {
        provider: 'meta_whatsapp',
        type: 'interactive',
        display: {
          kind: 'list',
          raw_type: 'list',
          body: 'Escolha uma opção',
          action_label: 'Selecionar',
        },
      },
    });
    const display = content?.official?.display;
    expect(display?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'section-1',
          title: null,
          rows: expect.arrayContaining([
            expect.objectContaining({
              id: '1',
              title: 'Endereço e finalizar',
              description: 'Descrição da opção 1',
            }),
            expect.objectContaining({
              id: '2',
              title: 'Opção 2',
              description: 'Localização e Atendimento',
            }),
          ]),
        }),
      ])
    );
  });

  it('maps provider native flow CTA URL messages to official display metadata', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeCtaUrlUpsert()
    ) as IChatMessage['content'];

    expect(content).toMatchObject({
      type: EMessageType.text,
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
    });
  });

  it('maps provider hydrated template messages to official template display metadata', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeTemplateUpsert()
    ) as IChatMessage['content'];

    expect(content).toMatchObject({
      type: EMessageType.official_template,
      message:
        'Olá, tudo bem?\n\nEu sou da underchat, gostaria de conversar contigo.\nTem um momento?',
      official_template: expect.objectContaining({
        name: 'abertura',
        language: '',
      }),
      official: {
        provider: 'meta_whatsapp',
        type: 'template',
        display: {
          kind: 'template',
          raw_type: 'template',
          title: null,
          body: 'Olá, tudo bem?\n\nEu sou da underchat, gostaria de conversar contigo.\nTem um momento?',
          footer: null,
          actions: [
            {
              type: 'URL',
              title: 'Qualquer dúvida',
              url: 'https://underchat.com.br/',
            },
          ],
        },
      },
    });
  });

  it('does not discard hydrated template messages as empty text', () => {
    const { consumer } = makeConsumer();

    expect((consumer as any).getDiscardUpsertReason(makeTemplateUpsert())).toBe(
      null
    );
  });

  it('normalizes prebuilt list metadata before indexing', () => {
    const { consumer } = makeConsumer();
    const upsert = makeTextUpsert('Escolha uma opção');
    upsert.content = {
      list: {
        text: 'Escolha uma opção',
        button_text: 'Selecionar',
        list_type: 'SINGLE_SELECT',
        sections: [
          {
            id: 'section-1',
            title: null,
            rows: [
              {
                id: '1',
                title: 'Atendimento',
                description: null,
              },
            ],
          },
        ],
      },
    } as IChatMessage['content'];

    const content = (consumer as any).buildMessageContent(
      upsert
    ) as IChatMessage['content'];

    expect(content?.list).toEqual(
      expect.objectContaining({
        list_type: 1,
      })
    );
  });

  it('maps provider list response messages to selected text and reply display metadata', () => {
    const { consumer } = makeConsumer();
    const content = (consumer as any).buildMessageContent(
      makeListResponseUpsert()
    ) as IChatMessage['content'];

    expect(content).toEqual(
      expect.objectContaining({
        type: EMessageType.text,
        message: 'Opção 2',
        quoted: expect.objectContaining({
          message: 'Escolha uma opção',
          list: expect.objectContaining({
            text: 'Escolha uma opção',
            button_text: 'Selecionar',
          }),
        }),
        official: expect.objectContaining({
          provider: 'meta_whatsapp',
          type: 'interactive',
          display: expect.objectContaining({
            kind: 'reply',
            raw_type: 'list_reply',
            title: 'Opção 2',
            body: 'Escolha uma opção',
            actions: [
              {
                id: '2',
                type: 'list_reply',
                title: 'Opção 2',
                description: 'Localização e Atendimento',
              },
            ],
          }),
        }),
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
      }),
      expect.objectContaining({ refresh: true })
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
      }),
      expect.objectContaining({
        outboundWebhook: expect.objectContaining({
          idempotencyKey: expect.stringContaining('waevt_v1_'),
        }),
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
      }),
      expect.objectContaining({
        outboundWebhook: expect.objectContaining({
          idempotencyKey: expect.stringContaining('waevt_v1_'),
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
      }),
      expect.objectContaining({
        outboundWebhook: expect.objectContaining({
          idempotencyKey: expect.stringContaining('waevt_v1_'),
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
      }),
      expect.objectContaining({
        outboundWebhook: expect.objectContaining({
          idempotencyKey: expect.stringContaining('waevt_v1_'),
        }),
      })
    );
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
  });

  it('runs provider photo effects only for the message creation winner', async () => {
    const {
      consumer,
      chat,
      chatService,
      storageService,
      elasticDatabaseService,
    } = makeConsumer();
    const data = {
      ...makeTextUpsert('Oi'),
      photo: 'https://pps.whatsapp.net/provider-photo.jpg',
    } as IUpsertMessage;
    let persistedMessage: IChatMessage | null = null;
    chatService.createMessageIdempotent
      .mockImplementationOnce(async (...args: unknown[]) => {
        const message = args[0] as IChatMessage;
        persistedMessage = message;
        return {
          created: true,
          conflict: false,
          id: message.message_id,
          attempted: true,
        };
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        const message = args[0] as IChatMessage;
        return {
          created: false,
          conflict: true,
          id: message.message_id,
          attempted: true,
        };
      });
    elasticDatabaseService.getById.mockImplementation(
      async () => persistedMessage
    );
    storageService.uploadFromUrl.mockResolvedValue({
      url: 'https://storage.test/provider-photo.jpg',
      name: 'provider-photo.jpg',
      mimetype: 'image/jpeg',
      size: 1,
    });

    await (consumer as any).createChatMessage(chat, data);
    await (consumer as any).createChatMessage(chat, data);

    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(2);
    expect(storageService.uploadFromUrl).toHaveBeenCalledTimes(1);
    expect(chatService.saveChat).toHaveBeenCalledTimes(1);
  });

  it('keeps recurring chat metadata mutations distinct while deduplicating a provider retry', async () => {
    const { consumer, chat, chatService, storageService } = makeConsumer();
    const providerPhoto = 'https://pps.whatsapp.net/provider-photo.jpg';
    const storedPhoto = 'https://storage.test/provider-photo.jpg';
    storageService.uploadFromUrl.mockResolvedValue({
      url: storedPhoto,
      name: 'provider-photo.jpg',
      mimetype: 'image/jpeg',
      size: 1,
    });
    const firstData = {
      ...makeTextUpsert('Oi'),
      photo: providerPhoto,
      message: {
        ...makeTextUpsert('Oi').message,
        key: {
          ...makeTextUpsert('Oi').message.key,
          id: 'provider-event-1',
        },
      },
    } as IUpsertMessage;
    const secondData = {
      ...firstData,
      message: {
        ...firstData.message,
        key: { ...firstData.message.key, id: 'provider-event-2' },
      },
    } as IUpsertMessage;

    await (consumer as any).updateChatPhotoIfNeeded(chat, firstData);
    await (consumer as any).updateChatPhotoIfNeeded(chat, firstData);
    await (consumer as any).updateChatPhotoIfNeeded(chat, secondData);

    const photoKeys = chatService.saveChat.mock.calls.map(
      (call: unknown[]) =>
        (
          call[1] as {
            outboundWebhook: { idempotencyKey: string };
          }
        ).outboundWebhook.idempotencyKey
    );
    expect(photoKeys[0]).toBe(photoKeys[1]);
    expect(photoKeys[0]).toContain('waevt_v1_');
    expect(photoKeys[2]).toContain('waevt_v1_');
    expect(photoKeys[2]).not.toBe(photoKeys[0]);

    const unnamedChat = { ...chat, name: null, contact: null } as IChat;
    await (consumer as any).updateChatNameIfNeeded(unnamedChat, firstData);
    await (consumer as any).updateChatNameIfNeeded(
      { ...unnamedChat, name: null },
      secondData
    );
    const nameKeys = chatService.updateChatNameIfMissing.mock.calls.map(
      (call: unknown[]) =>
        (call[2] as { idempotencyKey: string }).idempotencyKey
    );
    expect(nameKeys[0]).toContain('waevt_v1_');
    expect(nameKeys[1]).toContain('waevt_v1_');
    expect(nameKeys[1]).not.toBe(nameKeys[0]);
  });

  it('bubbles lock acquisition timeouts to the fail-closed runner parking hook', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    const error = new Error(
      'Failed to acquire lock "chat-create:account-1:worker-1:556999715039" after 90000ms'
    );
    error.name = 'LockAcquisitionTimeoutError';

    await expect(
      (consumer as any).handleProcessRetry(
        makeTextUpsert(),
        17,
        63535,
        1,
        1,
        true,
        error
      )
    ).rejects.toBe(error);

    expect(
      inboundMessageSpoolService.parkConsumerMessage
    ).not.toHaveBeenCalled();
  });

  it('parks a recoverable failure with the original Kafka key before allowing its offset to commit', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    const data = makeTextUpsert();
    const error = new Error('elasticsearch unavailable');

    await (consumer as any).parkRetryableKafkaMessage(
      data,
      {
        topic: 'upsert.message',
        partition: 16,
        offset: 158189,
        kafkaKey: 'original-account-worker-contact-key',
        attempt: 1,
        message: { timestamp: 1785330000000 },
      },
      error,
      'retry_exhausted'
    );

    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'message_upsert_consumer',
        reason: 'message_processing_retry_exhausted',
        kafka_topic: 'upsert.message',
        kafka_key: 'original-account-worker-contact-key',
        partition: 16,
        offset: 158189,
        retry_count: 1,
        upsert: data,
      })
    );
  });

  it('uses stable distinct identities for terminal records created in the same millisecond', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-17T22:46:00.000Z'));
    try {
      const { consumer, inboundMessageSpoolService } = makeConsumer();
      const first = makeTextUpsert('Primeira');
      const second: IUpsertMessage = {
        ...makeTextUpsert('Segunda'),
        message: {
          ...makeTextUpsert('Segunda').message,
          key: {
            ...makeTextUpsert('Segunda').message.key,
            id: 'message-second',
          },
        },
      };

      await (consumer as any).discardTerminalMessage(
        first,
        new Error('terminal'),
        'terminal_test',
        3,
        10
      );
      await (consumer as any).discardTerminalMessage(
        second,
        new Error('terminal'),
        'terminal_test',
        3,
        11
      );
      await (consumer as any).discardTerminalMessage(
        first,
        new Error('terminal'),
        'terminal_test',
        3,
        10
      );

      const parkedCalls = (
        inboundMessageSpoolService.parkConsumerMessage as jest.Mock
      ).mock.calls as Array<[IInboundMessageParkingPayload]>;
      expect(parkedCalls).toHaveLength(3);
      const [firstCall, secondCall, repeatedCall] = parkedCalls;
      if (!firstCall || !secondCall || !repeatedCall) {
        throw new Error('Expected three terminal parking calls');
      }
      const [firstPayload] = firstCall;
      const [secondPayload] = secondCall;
      const [repeatedPayload] = repeatedCall;
      expect(firstPayload).toEqual(
        expect.objectContaining({
          kafka_topic: 'upsert-message',
          dedupe_key: expect.any(String),
        })
      );
      expect(secondPayload.dedupe_key).not.toBe(firstPayload.dedupe_key);
      expect(repeatedPayload.dedupe_key).toBe(firstPayload.dedupe_key);
    } finally {
      jest.useRealTimers();
    }
  });

  it('terminally quarantines a message whose account or worker no longer exists', async () => {
    const {
      consumer,
      accountService,
      chatService,
      inboundMessageSpoolService,
      streamProducerService,
    } = makeConsumer();
    (accountService.viewAccountName as jest.Mock).mockResolvedValueOnce(null);
    (
      accountService.viewAccountNameConsistent as jest.Mock
    ).mockResolvedValueOnce(null);
    (consumer as any).runtimeFence = {
      isCurrent: jest.fn(async () => true),
      acquireEffectLease: jest.fn(),
    };
    const assertActive = jest.fn();
    const data = makeTextUpsert('Conta removida');

    await expect(
      (consumer as any).processKafkaMessageInPartition(
        jest.fn((key: string) => key),
        'upsert.message',
        data,
        9,
        144,
        {
          assertActive,
          attempt: 1,
          topic: 'upsert.message',
          partition: 9,
          offset: 144,
          message: {},
        }
      )
    ).resolves.toBeUndefined();

    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'account_or_worker_not_found',
        stage: 'message_upsert.discard.terminal',
        partition: 9,
        offset: 144,
        raw_meta: expect.objectContaining({
          missing_account_id: data.account_id,
          missing_worker_id: data.worker_id,
        }),
      })
    );
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('confirms account and worker on the primary before treating replica absence as terminal', async () => {
    const {
      consumer,
      accountService,
      workerService,
      chatService,
      inboundMessageSpoolService,
    } = makeConsumer();
    (accountService.viewAccountName as jest.Mock).mockResolvedValueOnce(null);
    (workerService.viewWorkerNameAndId as jest.Mock).mockResolvedValueOnce(
      null
    );
    (consumer as any).runtimeFence = {
      isCurrent: jest.fn(async () => true),
      acquireEffectLease: jest.fn(),
    };
    const data = makeTextUpsert('Visível apenas no primário');

    await (consumer as any).processKafkaMessageInPartition(
      jest.fn((key: string) => key),
      'upsert.message',
      data,
      9,
      145,
      {
        assertActive: jest.fn(),
        attempt: 1,
        topic: 'upsert.message',
        partition: 9,
        offset: 145,
        message: {},
      }
    );

    expect(accountService.viewAccountNameConsistent).toHaveBeenCalledWith(
      data.account_id
    );
    expect(workerService.viewWorkerNameAndIdConsistent).toHaveBeenCalledWith(
      data.account_id,
      data.worker_id
    );
    expect(chatService.saveChat).toHaveBeenCalledTimes(1);
    expect(
      inboundMessageSpoolService.parkConsumerMessage
    ).not.toHaveBeenCalled();
  });

  it('fails closed when recoverable parking cannot be persisted', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    inboundMessageSpoolService.parkConsumerMessage.mockRejectedValueOnce(
      new Error('redis unavailable')
    );

    await expect(
      (consumer as any).parkRetryableKafkaMessage(
        makeTextUpsert(),
        {
          topic: 'upsert.message',
          partition: 8,
          offset: 100,
          kafkaKey: 'original-key',
          attempt: 1,
          message: {},
        },
        new Error('processing unavailable'),
        'retry_exhausted'
      )
    ).rejects.toThrow('redis unavailable');
  });

  it('redrives a recoverable parked event with its original key under a runtime effect lease', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const release = jest.fn(async () => true);
    const assertOwned = jest.fn();
    const assertOwnedRemote = jest.fn(async () => undefined);
    (consumer as any).runtimeFence = {
      isCurrent: jest.fn(async () => true),
      acquireEffectLease: jest.fn(async () => ({
        assertOwned,
        assertOwnedRemote,
        release,
      })),
    };
    const upsert = makeTextUpsert();

    await expect(
      (consumer as any).redriveParkedConsumerMessage('upsert.message', {
        provider: 'message_upsert_consumer',
        account_id: upsert.account_id,
        worker_id: upsert.worker_id,
        event_source: 'message_upsert_consume',
        reason: 'consecutive_failures_exhausted',
        stage: 'message_upsert.consume.retry_parked',
        parked_at: new Date(0).toISOString(),
        kafka_topic: 'upsert.message',
        kafka_key: 'original-kafka-key',
        upsert,
      })
    ).resolves.toBe('published');

    expect(assertOwned).toHaveBeenCalledTimes(1);
    expect(assertOwnedRemote).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        ...upsert,
        consumer_redrive_attempt: 1,
      }),
      'original-kafka-key'
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('publishes a Redis-admitted parking even when its Meta timestamp is old', async () => {
    jest.useFakeTimers({
      now: new Date('2026-08-17T22:45:50.273Z'),
    });

    try {
      const { consumer, streamProducerService } = makeConsumer();
      const isCurrent = jest.fn(async () => true);
      const release = jest.fn(async () => true);
      const assertOwned = jest.fn();
      const assertOwnedRemote = jest.fn(async () => undefined);
      const acquireEffectLease = jest.fn(async () => ({
        assertOwned,
        assertOwnedRemote,
        release,
      }));
      (consumer as any).runtimeFence = {
        isCurrent,
        acquireEffectLease,
      };
      const base = makeTextUpsert('Mensagem antiga', {
        messageTimestamp: Math.floor(Date.now() / 1000),
      });
      const upsert: IUpsertMessage = {
        ...base,
        source_provider: 'official_whatsapp',
        content: {
          type: EMessageType.text,
          message: 'Mensagem antiga',
          official: {
            provider: 'meta_whatsapp',
            type: 'text',
            raw: {
              timestamp: '1786121019',
            },
          },
        },
      };
      const parking: IInboundMessageParkingPayload = {
        provider: 'message_upsert_consumer',
        account_id: upsert.account_id,
        worker_id: upsert.worker_id,
        event_source: 'message_upsert_consume',
        reason: 'message_processing_retry_exhausted',
        stage: 'message_upsert.consume.retry_parked',
        parked_at: '2026-08-17T22:45:20.000Z',
        kafka_topic: 'upsert.message',
        kafka_key: 'official-stale-key',
        retry_count: 3,
        upsert,
        raw_meta: {
          original_marker: 'preserved',
        },
      };

      await expect(
        (consumer as any).redriveParkedConsumerMessage(
          'upsert.message',
          parking
        )
      ).resolves.toBe('published');

      expect(parking.raw_meta).toEqual(
        expect.objectContaining({ original_marker: 'preserved' })
      );
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'upsert.message',
        expect.objectContaining({
          ...upsert,
          consumer_redrive_attempt: 3,
        }),
        'official-stale-key'
      );
      expect(isCurrent).toHaveBeenCalledTimes(1);
      expect(acquireEffectLease).toHaveBeenCalledTimes(1);
      expect(assertOwned).toHaveBeenCalledTimes(1);
      expect(assertOwnedRemote).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('discards a parked event from a stale runtime without republishing it', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    (consumer as any).runtimeFence = {
      isCurrent: jest.fn(async () => false),
      acquireEffectLease: jest.fn(),
    };

    await expect(
      (consumer as any).redriveParkedConsumerMessage('upsert.message', {
        provider: 'message_upsert_consumer',
        worker_id: 'worker-1',
        event_source: 'message_upsert_consume',
        reason: 'consecutive_failures_exhausted',
        stage: 'message_upsert.consume.retry_parked',
        parked_at: new Date(0).toISOString(),
        upsert: makeTextUpsert(),
      })
    ).resolves.toBe('discarded');

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('uses one short processing round before durable redrive', () => {
    const { consumer } = makeConsumer();

    expect((consumer as any).MAX_RETRIES).toBe(1);
    expect((consumer as any).MAX_CONSECUTIVE_FAILURES).toBe(1);
  });

  it('carries redrive lineage into the next parking attempt', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    const data = {
      ...makeTextUpsert(),
      consumer_redrive_attempt: 4,
    };

    await (consumer as any).parkRetryableKafkaMessage(
      data,
      {
        topic: 'upsert.message',
        partition: 1,
        offset: 2,
        kafkaKey: 'original-key',
        attempt: 1,
        message: {},
      },
      new Error('still unavailable'),
      'retry_exhausted'
    );

    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupe_key: expect.any(String),
        retry_count: 5,
      })
    );
  });

  it('uses topic partition and offset to dedupe messages without a stable event id', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    const withoutMessageId = () => {
      const data = makeTextUpsert();
      return {
        ...data,
        event_id: undefined,
        message: {
          ...data.message,
          key: {
            ...data.message.key,
            id: undefined,
          },
        },
      };
    };
    const parkAt = async (offset: number) =>
      (consumer as any).parkRetryableKafkaMessage(
        withoutMessageId(),
        {
          topic: 'upsert.message',
          partition: 8,
          offset,
          kafkaKey: null,
          attempt: 1,
          message: {},
        },
        new Error('processing unavailable'),
        'retry_exhausted'
      );

    await parkAt(100);
    await parkAt(101);
    await parkAt(100);

    const parkedCalls = inboundMessageSpoolService.parkConsumerMessage.mock
      .calls as unknown as Array<[{ dedupe_key?: string }]>;
    const dedupeKeys = parkedCalls.map(([payload]) => payload.dedupe_key);
    const parkingMembers = dedupeKeys.map(
      (dedupeKey) => `message_upsert_consumer:dedupe:${dedupeKey}`
    );
    expect(parkingMembers[0]).not.toBe(parkingMembers[1]);
    expect(parkingMembers[2]).toBe(parkingMembers[0]);
  });

  it('stops the parking redrive loop when Kafka runner startup fails', async () => {
    const { consumer, inboundMessageSpoolService } = makeConsumer();
    const startSpy = jest
      .spyOn(KafkaConsumerRunner.prototype, 'start')
      .mockRejectedValueOnce(new Error('kafka unavailable'));

    try {
      await expect(consumer.execute(jest.fn() as never)).rejects.toThrow(
        'kafka unavailable'
      );

      expect(
        inboundMessageSpoolService.startMessageUpsertConsumerRedrive
      ).toHaveBeenCalledTimes(1);
      expect(
        inboundMessageSpoolService.stopMessageUpsertConsumerRedrive
      ).toHaveBeenCalledTimes(1);
    } finally {
      startSpy.mockRestore();
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

  it('publishes mutation effects only when the physical inbound event is applied', async () => {
    const existingMessage = makeExistingMessage();
    const { consumer, chat, chatService, centrifugoService } = makeConsumer(
      elasticHit(existingMessage)
    );
    chatService.updateMessageChatIdempotent
      .mockResolvedValueOnce({ persisted: true, applied: true })
      .mockResolvedValueOnce({ persisted: true, applied: false });

    await (consumer as any).createChatMessage(chat, makeEditUpsert());
    const publishesAfterFirstEvent =
      centrifugoService.publishSub.mock.calls.length;
    expect(publishesAfterFirstEvent).toBeGreaterThan(0);

    await (consumer as any).createChatMessage(chat, makeEditUpsert());

    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(
      publishesAfterFirstEvent
    );
    expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(2);
    const firstMutation = chatService.updateMessageChatIdempotent.mock
      .calls[0][1] as { inboundEventId?: string; idempotencyKey?: string };
    const secondMutation = chatService.updateMessageChatIdempotent.mock
      .calls[1][1] as { inboundEventId?: string; idempotencyKey?: string };
    expect(firstMutation.inboundEventId).toMatch(/^waevt_v1_[a-f0-9]{64}$/);
    expect(secondMutation.inboundEventId).toBe(firstMutation.inboundEventId);
    expect(secondMutation.idempotencyKey).toBe(firstMutation.idempotencyKey);
  });

  it('recomposes two concurrent inbound reactions from fresh message state', async () => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const initialMessage = makeExistingMessage();
    let persistedMessage: IChatMessage = {
      ...initialMessage,
      content: {
        ...initialMessage.content,
        type: initialMessage.content?.type ?? EMessageType.text,
        reactions: null,
      },
    };
    const { consumer, chat, chatService, elasticDatabaseService } =
      makeConsumer(elasticHit(persistedMessage));
    elasticDatabaseService.select.mockImplementation(async () =>
      elasticHit(clone(persistedMessage))
    );
    elasticDatabaseService.getById.mockImplementation(async () =>
      clone(persistedMessage)
    );
    chatService.updateMessageChatIdempotent.mockImplementation(
      async (...args: unknown[]) => {
        const message = args[0] as IChatMessage;
        persistedMessage = clone(message);
        return { persisted: true, applied: true };
      }
    );

    const firstReaction = makeReactionUpsert({
      phone: '5511111111111',
      messageId: 'reaction-event-1',
      targetMessageId,
    });
    const secondReaction = makeReactionUpsert({
      phone: '5522222222222',
      messageId: 'reaction-event-2',
      targetMessageId,
    });

    const withLockMock = withLock as jest.Mock;
    const previousLockImplementation = withLockMock.getMockImplementation();
    const lockCallStart = withLockMock.mock.calls.length;
    const lockTails = new Map<string, Promise<void>>();
    withLockMock.mockImplementation(
      async (_redis, key: string, fn: () => Promise<unknown>) => {
        const previous = lockTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => gate);
        lockTails.set(key, tail);

        await previous;
        try {
          return await fn();
        } finally {
          release();
          if (lockTails.get(key) === tail) {
            lockTails.delete(key);
          }
        }
      }
    );

    try {
      await Promise.all([
        (consumer as any).handleReactionMessage(chat, firstReaction),
        (consumer as any).handleReactionMessage(chat, secondReaction),
      ]);

      expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(2);
      expect(persistedMessage.content?.reactions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            emoji: '👍',
            user_id: '5511111111111@s.whatsapp.net',
          }),
          expect.objectContaining({
            emoji: '👍',
            user_id: '5522222222222@s.whatsapp.net',
          }),
        ])
      );
      expect(persistedMessage.content?.reactions).toHaveLength(2);

      const mutationLockKeys = withLockMock.mock.calls
        .slice(lockCallStart)
        .map((call) => call[1]);
      expect(mutationLockKeys).toEqual([
        `inbound-message-mutation:account-1:${persistedMessage.message_id}`,
        `inbound-message-mutation:account-1:${persistedMessage.message_id}`,
      ]);
    } finally {
      withLockMock.mockImplementation(
        previousLockImplementation ??
          (async (_redis, _key, fn: () => Promise<unknown>) => fn())
      );
    }
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
    elasticDatabaseService.getById.mockResolvedValue(existingMessage);

    const result = await (consumer as any).createChatMessage(
      chat,
      makeEditUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(1);
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

    const updatedMessage = chatService.updateMessageChatIdempotent.mock
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
    elasticDatabaseService.getById.mockResolvedValue(existingMessage);

    const result = await (consumer as any).createChatMessage(
      chat,
      makeNestedEditUpsert()
    );

    expect(result.handled).toBe(true);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(1);

    const updatedMessage = chatService.updateMessageChatIdempotent.mock
      .calls[0][0] as IChatMessage;
    expect(updatedMessage.message_id).toBe(existingMessage.message_id);
    expect(updatedMessage.content?.version).toEqual([
      expect.objectContaining({
        type: EMessageType.text,
        message: adBody,
      }),
    ]);
  });

  it.each([
    ['edit', () => makeEditUpsert()],
    ['delete', () => makeDeleteUpsert()],
  ])(
    'resets inactivity only once when the same %s event is replayed',
    async (_label, buildMutation) => {
      const existingMessage = makeExistingMessage();
      const { consumer, chat, chatService, attendanceInactivityService } =
        makeConsumer(elasticHit(existingMessage));
      chat.status = EChatStatus.in_chat;
      chatService.updateMessageChatIdempotent
        .mockResolvedValueOnce({ persisted: true, applied: true })
        .mockResolvedValueOnce({ persisted: true, applied: false });
      const mutation = buildMutation();

      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        mutation
      );
      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        mutation
      );

      expect(
        attendanceInactivityService.resetOnContactMessage
      ).toHaveBeenCalledTimes(1);
      expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(2);
      expect(
        chatService.updateMessageChatIdempotent.mock.calls.map(
          (call) =>
            (call[1] as { inboundEventId?: string | null }).inboundEventId
        )
      ).toEqual([mutation.event_id, mutation.event_id]);
    }
  );

  it.each([
    ['edit', () => makeEditUpsert()],
    ['delete', () => makeDeleteUpsert()],
  ])(
    'keeps inactivity effects for distinct %s event identities',
    async (_label, buildMutation) => {
      const existingMessage = makeExistingMessage();
      const { consumer, chat, chatService, attendanceInactivityService } =
        makeConsumer(elasticHit(existingMessage));
      chat.status = EChatStatus.in_chat;
      const firstMutation = {
        ...buildMutation(),
        event_id: 'waevt-test-distinct-1',
      };
      const secondMutation = {
        ...buildMutation(),
        event_id: 'waevt-test-distinct-2',
      };

      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        firstMutation
      );
      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        secondMutation
      );

      expect(
        attendanceInactivityService.resetOnContactMessage
      ).toHaveBeenCalledTimes(2);
      expect(
        chatService.updateMessageChatIdempotent.mock.calls.map(
          (call) =>
            (call[1] as { inboundEventId?: string | null }).inboundEventId
        )
      ).toEqual(['waevt-test-distinct-1', 'waevt-test-distinct-2']);
    }
  );

  it.each([
    ['normal message', EMessageType.text, false],
    ['annotation', EMessageType.annotation, true],
  ])(
    'does not repeat inactivity effects for a replayed %s create conflict',
    async (_label, messageType, fromMe) => {
      const {
        consumer,
        chat,
        chatService,
        elasticDatabaseService,
        attendanceInactivityService,
      } = makeConsumer();
      chat.status = EChatStatus.in_chat;
      const base = makeTextUpsert('Ocorrência idempotente', { fromMe });
      const upsert: IUpsertMessage = {
        ...base,
        type: messageType,
        content: {
          type: messageType,
          message: 'Ocorrência idempotente',
        },
      };
      const persistedMessage: IChatMessage = {
        ...makeExistingMessage(),
        message_id: 'message-created',
        message_key: {
          ...(makeExistingMessage().message_key ?? {}),
          from_me: fromMe,
          is_view_once:
            makeExistingMessage().message_key?.is_view_once ?? false,
        },
        type_user: fromMe ? ETypeUserChat.operator : ETypeUserChat.client,
        content: {
          type: messageType,
          message: 'Ocorrência idempotente',
        },
      };
      chatService.createMessageIdempotent
        .mockResolvedValueOnce({
          created: true,
          conflict: false,
          id: 'message-created',
          attempted: true,
        })
        .mockResolvedValueOnce({
          created: false,
          conflict: true,
          id: 'message-created',
          attempted: true,
        });
      elasticDatabaseService.getById.mockResolvedValue(persistedMessage);

      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        upsert
      );
      await (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        upsert
      );

      if (messageType === EMessageType.annotation) {
        expect(
          attendanceInactivityService.resetOnOperatorAnnotationMessage
        ).toHaveBeenCalledTimes(1);
      } else {
        expect(
          attendanceInactivityService.resetOnContactMessage
        ).toHaveBeenCalledTimes(1);
      }
    }
  );

  it('does not repeat reaction inactivity effects when persistence reports a replay', async () => {
    const targetMessage: IChatMessage = {
      ...makeExistingMessage(),
      type_user: ETypeUserChat.operator,
    };
    const { consumer, chat, chatService, attendanceInactivityService } =
      makeConsumer(elasticHit(targetMessage));
    chat.status = EChatStatus.in_chat;
    chatService.updateMessageChatIdempotent
      .mockResolvedValueOnce({ persisted: true, applied: true })
      .mockResolvedValueOnce({ persisted: true, applied: false });
    const reaction = makeReactionUpsert({ targetMessageId });

    await (consumer as any).createOrUpdateChatQueue(
      jest.fn((key: string) => key),
      chat,
      reaction
    );
    await (consumer as any).createOrUpdateChatQueue(
      jest.fn((key: string) => key),
      chat,
      reaction
    );

    expect(
      attendanceInactivityService.resetOnContactMessage
    ).toHaveBeenCalledTimes(1);
  });

  it('replaces a ciphertext system fallback when the real text arrives with the same key', async () => {
    const existingMessage = {
      ...makeExistingCiphertextSystemMessage(),
      sent_from_platform: true,
    };
    const persistedReplacement = {
      ...existingMessage,
      type_user: ETypeUserChat.client,
      content: {
        type: EMessageType.text,
        message: 'texto confirmado no Elasticsearch',
      },
      date: '2026-05-08T09:30:00.000Z',
    } as IChatMessage;
    const {
      consumer,
      chat,
      chatService,
      elasticDatabaseService,
      centrifugoService,
    } = makeConsumer(elasticHit(existingMessage));
    elasticDatabaseService.getById.mockResolvedValueOnce(persistedReplacement);

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
    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.message,
      existingMessage.message_id
    );

    const publishedMessage = centrifugoService.publishSub.mock.calls.find(
      ([, payload]) =>
        (payload as IChatMessage | undefined)?.message_id ===
        existingMessage.message_id
    )?.[1];
    expect(publishedMessage).toBe(persistedReplacement);
    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      chat.chat_id,
      'texto confirmado no Elasticsearch',
      persistedReplacement.date,
      new Date(persistedReplacement.date).getTime(),
      persistedReplacement.message_id,
      persistedReplacement.message_id,
      false,
      ETypeUserChat.client,
      false
    );
  });

  it('does not publish or update the summary when a ciphertext replacement is not persisted', async () => {
    const existingMessage = {
      ...makeExistingCiphertextSystemMessage(),
      sent_from_platform: true,
    };
    const {
      consumer,
      chat,
      chatService,
      elasticDatabaseService,
      centrifugoService,
    } = makeConsumer(elasticHit(existingMessage));
    chatService.updateMessageChat.mockResolvedValueOnce(false);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat message replacement persistence was not confirmed: ${existingMessage.message_id}`
    );

    expect(elasticDatabaseService.getById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(chatService.updateChatSummaryAtomically).not.toHaveBeenCalled();
  });

  it('throws a retryable error when message creation is not confirmed', async () => {
    const { consumer, chat, chatService, centrifugoService } = makeConsumer();
    chatService.createMessageIdempotent.mockResolvedValueOnce({
      created: false,
      conflict: false,
      id: 'message-failed',
      attempted: true,
    });

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat message persistence was not confirmed: ${chat.chat_id}`
    );

    expect(chatService.updateChatSummaryAtomically).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('retries a newly persisted message when its summary update fails', async () => {
    const {
      consumer,
      chat,
      chatService,
      centrifugoService,
      pushNotificationService,
    } = makeConsumer();
    chatService.updateChatSummaryAtomically.mockResolvedValue(false);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat summary persistence was not confirmed: ${chat.chat_id}`
    );

    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledTimes(3);
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(1);
    expect(
      pushNotificationService.sendNotificationForChatMessage
    ).not.toHaveBeenCalled();
  });

  it('retries a newly persisted message when the chat reload is missing', async () => {
    const {
      consumer,
      chat,
      chatService,
      centrifugoService,
      pushNotificationService,
    } = makeConsumer();
    chatService.findChatByChatId.mockResolvedValueOnce(null);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat persistence was not found after message creation: ${chat.chat_id}`
    );

    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(1);
    expect(
      pushNotificationService.sendNotificationForChatMessage
    ).not.toHaveBeenCalled();
  });

  it('recovers the summary and publishes only the confirmed chat snapshot for an existing message', async () => {
    const existingMessage = {
      ...makeExistingMessage(),
      content: { type: EMessageType.text, message: adBody },
    } as IChatMessage;
    const {
      consumer,
      chat,
      chatService,
      centrifugoService,
      pushNotificationService,
    } = makeConsumer(elasticHit(existingMessage));
    const chatWithOlderSummary = {
      ...chat,
      summary: {
        last_message: 'mensagem anterior',
        last_date: '2026-05-07T20:00:00.000Z',
        last_date_epoch_millis: new Date('2026-05-07T20:00:00.000Z').getTime(),
        last_message_id: 'message-older',
        last_processed_message_id: 'message-older',
        unread_count: 1,
      },
    } as IChat;

    await expect(
      (consumer as any).createChatMessage(
        chatWithOlderSummary,
        makeTextUpsert()
      )
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
      })
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      chat.chat_id,
      adBody,
      existingMessage.date,
      new Date(existingMessage.date).getTime(),
      existingMessage.message_id,
      existingMessage.message_id,
      true,
      ETypeUserChat.client,
      false
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
    for (const [, payload] of centrifugoService.publishSub.mock.calls) {
      expect(payload).toEqual(
        expect.objectContaining({ chat_id: chat.chat_id })
      );
      expect(payload).not.toEqual(
        expect.objectContaining({ message_id: expect.anything() })
      );
    }
    expect(
      pushNotificationService.sendNotificationForChatMessage
    ).not.toHaveBeenCalled();
  });

  it('does not increment unread for a late redelivery older than the current processed message', async () => {
    const existingMessage = {
      ...makeExistingMessage(),
      content: { type: EMessageType.text, message: adBody },
    } as IChatMessage;
    const { consumer, chat, chatService } = makeConsumer(
      elasticHit(existingMessage)
    );
    const chatWithNewerSummary = {
      ...chat,
      summary: {
        last_message: 'mensagem mais nova',
        last_date: '2026-05-08T10:00:00.000Z',
        last_message_id: 'message-newer',
        last_processed_message_id: 'message-newer',
        unread_count: 2,
      },
    } as IChat;

    await (consumer as any).createChatMessage(
      chatWithNewerSummary,
      makeTextUpsert()
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      chat.chat_id,
      adBody,
      existingMessage.date,
      new Date(existingMessage.date).getTime(),
      existingMessage.message_id,
      existingMessage.message_id,
      false,
      ETypeUserChat.client,
      false
    );
  });

  it('does not increment unread when the recovered message was already processed', async () => {
    const existingMessage = {
      ...makeExistingMessage(),
      content: { type: EMessageType.text, message: adBody },
    } as IChatMessage;
    const { consumer, chat, chatService } = makeConsumer(
      elasticHit(existingMessage)
    );
    const alreadyProcessedChat = {
      ...chat,
      summary: {
        last_message: adBody,
        last_date: existingMessage.date,
        last_date_epoch_millis: new Date(existingMessage.date).getTime(),
        last_message_id: existingMessage.message_id,
        last_processed_message_id: existingMessage.message_id,
        unread_count: 1,
      },
    } as IChat;

    await (consumer as any).createChatMessage(
      alreadyProcessedChat,
      makeTextUpsert()
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      chat.chat_id,
      adBody,
      existingMessage.date,
      new Date(existingMessage.date).getTime(),
      existingMessage.message_id,
      existingMessage.message_id,
      false,
      ETypeUserChat.client,
      false
    );
  });

  it('recovers summary effects from the persisted message after an idempotency conflict', async () => {
    const persistedMessage = makeExistingMessage();
    const {
      consumer,
      chat,
      chatService,
      elasticDatabaseService,
      centrifugoService,
      pushNotificationService,
    } = makeConsumer();
    chatService.createMessageIdempotent.mockResolvedValueOnce({
      created: false,
      conflict: true,
      id: persistedMessage.message_id,
      attempted: true,
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(persistedMessage);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).resolves.toEqual(expect.objectContaining({ handled: true }));

    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.message,
      persistedMessage.message_id
    );
    expect(
      elasticDatabaseService.getById.mock.invocationCallOrder[0]
    ).toBeLessThan(
      chatService.patchExistingMessageMissingFields.mock.invocationCallOrder[0]
    );
    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      chat.chat_id,
      'texto anterior',
      persistedMessage.date,
      new Date(persistedMessage.date).getTime(),
      persistedMessage.message_id,
      persistedMessage.message_id,
      true,
      ETypeUserChat.client,
      false
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
    expect(
      pushNotificationService.sendNotificationForChatMessage
    ).not.toHaveBeenCalled();
  });

  it('accepts a provider replay persisted in an older chat without patching or mutating the current chat', async () => {
    const persistedMessage = {
      ...makeExistingMessage(),
      message_id: 'message-in-previous-chat',
      chat_id: 'chat-closed-previous',
    } as IChatMessage;
    const {
      consumer,
      chat,
      chatService,
      elasticDatabaseService,
      centrifugoService,
    } = makeConsumer();
    chatService.createMessageIdempotent.mockResolvedValueOnce({
      created: false,
      conflict: true,
      id: persistedMessage.message_id,
      attempted: true,
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(persistedMessage);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).resolves.toEqual({
      handled: true,
      effectsApplied: false,
      reactionInactivityInteraction: null,
    });

    expect(
      chatService.patchExistingMessageMissingFields
    ).not.toHaveBeenCalled();
    expect(chatService.updateChatSummaryAtomically).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it.each([
    [
      'another account',
      {
        account: { id: 'account-2', name: 'Other account' },
      },
    ],
    [
      'another worker',
      {
        worker: { id: 'worker-2', name: 'Other worker' },
      },
    ],
    [
      'another provider message identity',
      {
        message_key: {
          ...makeExistingMessage().message_key,
          id: 'different-provider-message',
        },
      },
    ],
  ])(
    'rejects an idempotency conflict owned by %s before applying any patch',
    async (_label, override) => {
      const persistedMessage = {
        ...makeExistingMessage(),
        ...override,
        message_id: 'unsafe-conflict',
      } as IChatMessage;
      const { consumer, chat, chatService, elasticDatabaseService } =
        makeConsumer();
      chatService.createMessageIdempotent.mockResolvedValueOnce({
        created: false,
        conflict: true,
        id: persistedMessage.message_id,
        attempted: true,
      });
      elasticDatabaseService.getById.mockResolvedValueOnce(persistedMessage);

      await expect(
        (consumer as any).createChatMessage(chat, makeTextUpsert())
      ).rejects.toThrow(
        'Persisted chat message ownership did not match idempotency conflict'
      );

      expect(
        chatService.patchExistingMessageMissingFields
      ).not.toHaveBeenCalled();
      expect(chatService.updateChatSummaryAtomically).not.toHaveBeenCalled();
    }
  );

  it('retries an existing message when summary recovery cannot be confirmed', async () => {
    const existingMessage = {
      ...makeExistingMessage(),
      content: { type: EMessageType.text, message: adBody },
    } as IChatMessage;
    const { consumer, chat, chatService, centrifugoService } = makeConsumer(
      elasticHit(existingMessage)
    );
    chatService.updateChatSummaryAtomically.mockResolvedValue(false);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat summary persistence was not confirmed: ${chat.chat_id}`
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledTimes(3);
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('retries an existing message when the chat reload after summary recovery is missing', async () => {
    const existingMessage = {
      ...makeExistingMessage(),
      content: { type: EMessageType.text, message: adBody },
    } as IChatMessage;
    const { consumer, chat, chatService, centrifugoService } = makeConsumer(
      elasticHit(existingMessage)
    );
    chatService.findChatByChatId.mockResolvedValueOnce(null);

    await expect(
      (consumer as any).createChatMessage(chat, makeTextUpsert())
    ).rejects.toThrow(
      `Chat persistence was not found after summary recovery: ${chat.chat_id}`
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
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
      }),
      expect.objectContaining({
        eventTypes: ['message.updated'],
        previousMessage: existingMessage,
        source: 'message_upsert',
      })
    );
  });

  it('does not silently accept an existing message whose chat document is missing', async () => {
    const existingMessage = makeExistingMessage();
    const { consumer, chatService } = makeConsumer(elasticHit(existingMessage));
    chatService.findChatByChatId.mockResolvedValue(null);

    await expect(
      (consumer as any).createOrUpdateChat(
        jest.fn((key: string) => key),
        makeTextUpsert(),
        '556999715039'
      )
    ).rejects.toThrow(
      `Chat persistence was not found for existing message: ${existingMessage.chat_id}`
    );

    expect(chatService.findChatByPhone).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
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
    elasticDatabaseService.getById.mockResolvedValue(existingMessage);
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
    expect(chatService.updateMessageChatIdempotent).toHaveBeenCalledTimes(1);

    const updatedMessage = chatService.updateMessageChatIdempotent.mock
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
      let assignmentActive = true;
      const assertActive = jest.fn(() => {
        if (!assignmentActive) {
          throw new Error('Kafka consumer assignment was revoked');
        }
      });

      await runWithKafkaDispatchGuard(assertActive, () =>
        (consumer as any).createOrUpdateChat(
          jest.fn((key: string) => key),
          data,
          '556999715039'
        )
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
        'chatbot-input',
        undefined,
        expect.objectContaining({
          assertActive: expect.any(Function),
          executionId: expect.any(String),
          requireHandled: true,
        })
      );

      assignmentActive = false;
      expect(() => assertActive()).toThrow(
        'Kafka consumer assignment was revoked'
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
        'chatbot-transfer',
        undefined,
        expect.objectContaining({
          executionId: expect.any(String),
          requireHandled: true,
        })
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
      null,
      1778190016000,
      expect.stringContaining('waevt_v1_'),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('waevt_v1_'),
      })
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

  it('does not repeat assignment or push when message persistence retries after a transfer', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    const upsert = {
      ...makeTextUpsert('Mensagem após transferência'),
      transfer_user_id: 'user-2',
    };
    chatService.createMessageIdempotent.mockRejectedValueOnce(
      new Error('simulated crash after transfer')
    );

    await expect(
      (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        upsert
      )
    ).rejects.toThrow('simulated crash after transfer');

    await expect(
      (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        upsert
      )
    ).resolves.toBeUndefined();

    expect(chatService.updateChatUserAndSector).toHaveBeenCalledTimes(1);
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).toHaveBeenCalledTimes(1);
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(2);
    expect(chat.meta?.assignment_event_id).toBe(upsert.event_id);
    expect(chat.meta?.assignment_epoch).toBe(1778190016000);
  });

  it('fails closed when a transfer event has no immutable timestamp', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    const upsert = {
      ...makeTextUpsert(),
      transfer_user_id: 'user-2',
    };
    delete upsert.message.messageTimestamp;

    await expect(
      (consumer as any).processTransferIfNeeded(jest.fn(), chat, upsert)
    ).rejects.toThrow(
      'Chat transfer requires an immutable inbound event timestamp'
    );

    expect(chatService.updateChatUserAndSector).not.toHaveBeenCalled();
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });

  it('treats an older transfer retry as superseded and still persists its message', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    chat.user = { id: 'user-newer', name: 'Newer User', photo: null };
    chat.meta = {
      ...(chat.meta ?? {}),
      assignment_epoch: 1778190017000,
      assignment_event_id: 'waevt-newer-transfer',
    };
    const upsert = {
      ...makeTextUpsert('Mensagem de um evento anterior'),
      transfer_user_id: 'user-2',
    };

    await expect(
      (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        chat,
        upsert
      )
    ).resolves.toBeUndefined();

    expect(chatService.updateChatUserAndSector).not.toHaveBeenCalled();
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
    expect(chatService.createMessageIdempotent).toHaveBeenCalledTimes(1);
    expect(chat.user?.id).toBe('user-newer');
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

  it('does not notify a human user transfer when assignment persistence fails', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    chatService.updateChatUserAndSector.mockResolvedValueOnce(false);

    await expect(
      (consumer as any).transferToUser(jest.fn(), chat, {
        ...makeTextUpsert(),
        transfer_user_id: 'user-2',
      })
    ).rejects.toThrow(
      `Chat transfer persistence was not confirmed: ${chat.chat_id}`
    );

    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });

  it('does not notify a human sector transfer when the persisted assignment does not match', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    chatService.updateChatUserAndSector.mockResolvedValueOnce(true);

    await expect(
      (consumer as any).transferToSector(jest.fn(), chat, {
        ...makeTextUpsert(),
        transfer_sector_id: 'sector-2',
      })
    ).rejects.toThrow(
      `Chat transfer snapshot was not confirmed: ${chat.chat_id}`
    );

    expect(chatService.findChatByChatId).toHaveBeenCalledWith(
      chat.account.id,
      chat.chat_id
    );
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });

  it('clears chatbot runtime without notifying a requested target after a concurrent human handoff', async () => {
    const {
      consumer,
      chat,
      chatService,
      chatbotFlowRunnerService,
      pushNotificationService,
    } = makeConsumer();
    const automationChat = {
      ...chat,
      status: EChatStatus.ura,
    } as IChat;
    const concurrentHumanChat = {
      ...chat,
      status: EChatStatus.in_chat,
      user: { id: 'user-concurrent', name: 'Concurrent User', photo: null },
    } as IChat;
    chatService.transferAutomationChatToQueue.mockResolvedValueOnce({
      chat: concurrentHumanChat,
      previousChat: concurrentHumanChat,
      applied: false,
      alreadyHuman: true,
    });

    await expect(
      (consumer as any).transferToUser(jest.fn(), automationChat, {
        ...makeTextUpsert(),
        transfer_user_id: 'user-2',
      })
    ).resolves.toEqual(concurrentHumanChat);

    expect(chatbotFlowRunnerService.clearFlowCacheForChat).toHaveBeenCalledWith(
      automationChat.account.id,
      automationChat.worker.id,
      automationChat.chat_id
    );
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });

  it('passes the deterministic inbound revision to chatbot handoff persistence', async () => {
    const { consumer, chat, chatService } = makeConsumer();
    const automationChat = {
      ...chat,
      status: EChatStatus.ura,
    } as IChat;
    const upsert = {
      ...makeTextUpsert(),
      transfer_user_id: 'user-2',
    };

    await (consumer as any).transferToUser(jest.fn(), automationChat, upsert);

    expect(chatService.transferAutomationChatToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventEpochMillis: 1778190016000,
        eventId: expect.stringContaining('waevt_v1_'),
      })
    );
    expect(
      chatService.transferAutomationChatToQueue.mock.calls[0][0].eventId
    ).toBe(upsert.event_id);
  });

  it('does not push a stale chatbot handoff when a newer assignment wins inside the atomic patch', async () => {
    const { consumer, chat, chatService, pushNotificationService } =
      makeConsumer();
    const automationChat = {
      ...chat,
      status: EChatStatus.ura,
      user: null,
      sector: null,
      meta: {
        status_epoch: 100,
        status_event_id: 'status-100',
        assignment_epoch: 100,
        assignment_event_id: 'assignment-100',
      },
    } as IChat;
    const concurrentAssignmentChat = {
      ...automationChat,
      user: { id: 'user-newer', name: 'Newer User', photo: null },
      sector: { id: 'sector-newer', name: 'Newer Sector', color: '#000' },
      meta: {
        ...automationChat.meta,
        assignment_epoch: 1778190017000,
        assignment_event_id: 'assignment-newer',
      },
    } as IChat;
    chatService.findChatByChatId
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(concurrentAssignmentChat);
    chatService.transferAutomationChatToQueue.mockResolvedValueOnce({
      chat: concurrentAssignmentChat,
      previousChat: automationChat,
      applied: false,
      alreadyHuman: false,
    });

    await expect(
      (consumer as any).transferToUser(jest.fn(), automationChat, {
        ...makeTextUpsert(),
        transfer_user_id: 'user-2',
      })
    ).resolves.toEqual(concurrentAssignmentChat);

    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
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

  it('aborts a new chat before saving its message or publishing when chat persistence is not confirmed', async () => {
    const { consumer, chatService, centrifugoService } = makeConsumer();
    chatService.saveChat.mockResolvedValueOnce(false);

    await expect(
      (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        null,
        makeTextUpsert('Mensagem sem chat persistido')
      )
    ).rejects.toThrow('Chat persistence was not confirmed');

    expect(chatService.invalidateChatCache).toHaveBeenCalledTimes(1);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not publish an in-memory chat when its confirmed reload is missing', async () => {
    const { consumer, chatService, centrifugoService } = makeConsumer();
    chatService.findChatByChatId.mockResolvedValueOnce(null);

    await expect(
      (consumer as any).createOrUpdateChatQueue(
        jest.fn((key: string) => key),
        null,
        makeTextUpsert('Mensagem com releitura ausente')
      )
    ).rejects.toThrow(
      'Chat persistence was not confirmed before message creation'
    );

    expect(chatService.saveChat).toHaveBeenCalledTimes(1);
    expect(chatService.createMessageIdempotent).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
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

  it('releases a failed outside-hours publish and republishes the same deterministic operation on redelivery', async () => {
    const { consumer, chat, chatMessageService, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Mensagem recebida'),
      event_id: 'waevt_v1_physical-message-1',
    };
    chatMessageService.sendMessage
      .mockRejectedValueOnce(new Error('kafka_ack_unknown'))
      .mockResolvedValue(true);

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        sourceEvent,
        chat,
        'Estamos fora do horário'
      )
    ).rejects.toThrow('kafka_ack_unknown');
    expect(
      [...leaseState.values.keys()].filter((key) =>
        key.startsWith('automation-send:idempotency:v1:')
      )
    ).toHaveLength(0);

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        sourceEvent,
        chat,
        'Conteúdo alterado, mesma operação física'
      )
    ).resolves.toBeUndefined();
    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(2);

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        sourceEvent,
        chat,
        'Mesmo evento já concluído'
      )
    ).resolves.toBeUndefined();
    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(2);

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        {
          ...makeTextUpsert('Mensagem repetida de propósito'),
          event_id: 'waevt_v1_physical-message-2',
        },
        chat,
        'Estamos fora do horário'
      )
    ).resolves.toBeUndefined();

    const sendCalls = chatMessageService.sendMessage.mock.calls as unknown[][];
    const firstMessageId = (sendCalls[0][1] as { messageId: string }).messageId;
    const retryMessageId = (sendCalls[1][1] as { messageId: string }).messageId;
    const distinctMessageId = (sendCalls[2][1] as { messageId: string })
      .messageId;
    expect(firstMessageId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
    );
    expect(retryMessageId).toBe(firstMessageId);
    expect(distinctMessageId).not.toBe(firstMessageId);
    expect(
      [...leaseState.values.entries()].filter(([key]) =>
        key.startsWith('automation-send:idempotency:v1:')
      )
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.any(String), '1']),
      ])
    );
    expect(redis.del).toHaveBeenCalledWith(
      `underchat:attendance-hours:debounce:${sourceEvent.account_id}:${chat.chat_id}`
    );
  });

  it('retries a failed chatbot dispatch with the same deterministic execution and completes only after success', async () => {
    const { consumer, chat, chatbotFlowRunnerService, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Oi'),
      event_id: 'waevt_v1_chatbot-publish-retry',
    };
    chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);
    const execute = chatbotFlowRunnerService.execute as jest.Mock<
      Promise<string | null | undefined>,
      unknown[]
    >;
    execute
      .mockRejectedValueOnce(new Error('kafka_publish_failed_after_persist'))
      .mockResolvedValue('flow-node-1');
    Object.assign(consumer, {
      ensureChatAndHandleMessage: jest.fn(async () => chat),
    });

    await expect(
      (consumer as any).createOrUpdateChatBotFlow(
        (key: string) => key,
        chat,
        sourceEvent,
        'chatbot-1'
      )
    ).rejects.toThrow('kafka_publish_failed_after_persist');
    expect(leaseState.values.size).toBe(0);

    await expect(
      (consumer as any).createOrUpdateChatBotFlow(
        (key: string) => key,
        chat,
        sourceEvent,
        'chatbot-1'
      )
    ).resolves.toBe('flow-node-1');
    await expect(
      (consumer as any).createOrUpdateChatBotFlow(
        (key: string) => key,
        chat,
        sourceEvent,
        'chatbot-1'
      )
    ).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    const firstExecutionOptions = execute.mock.calls[0][5] as {
      executionId: string;
      requireHandled: boolean;
    };
    const retriedExecutionOptions = execute.mock.calls[1][5] as {
      executionId: string;
      requireHandled: boolean;
    };
    expect(firstExecutionOptions).toEqual(
      expect.objectContaining({ requireHandled: true })
    );
    expect(retriedExecutionOptions.executionId).toBe(
      firstExecutionOptions.executionId
    );
    expect([...leaseState.values.values()]).toEqual(['1']);
  });

  it('fails a live processing claim closed and resumes only after that lease expires', async () => {
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Oi'),
      event_id: 'waevt_v1_processing-crash',
    };
    const subject = consumer as any;

    const first = await subject.acquireAutomationSendAttempt(
      sourceEvent,
      'chatbot_flow'
    );
    expect(first.status).toBe('acquired');
    expect(leaseState.ttls.get(first.claim.leaseKey)).toBeGreaterThan(120);
    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'chatbot_flow')
    ).rejects.toThrow('already in progress');

    leaseState.values.delete(first.claim.leaseKey);
    leaseState.ttls.delete(first.claim.leaseKey);
    await expect(
      subject.acquireAutomationSendAttempt(sourceEvent, 'chatbot_flow')
    ).resolves.toEqual(expect.objectContaining({ status: 'acquired' }));
  });

  it('keeps v2 processing invisible to legacy readers and writes legacy completion only after success', async () => {
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Compatibilidade rolling'),
      event_id: 'waevt_v1_rolling-lease-compatibility',
    };
    const subject = consumer as any;

    const acquired = await subject.acquireAutomationSendAttempt(
      sourceEvent,
      'chatbot_flow'
    );

    expect(
      acquired.claim.completionKey.startsWith('automation-send:idempotency:v1:')
    ).toBe(true);
    expect(
      acquired.claim.leaseKey.startsWith('automation-send:processing:v2:')
    ).toBe(true);
    expect(leaseState.values.has(acquired.claim.completionKey)).toBe(false);
    expect(leaseState.values.get(acquired.claim.leaseKey)).toBe(
      acquired.claim.ownerValue
    );

    await subject.completeAutomationSendAttempt(acquired.claim);

    expect(leaseState.values.get(acquired.claim.completionKey)).toBe('1');
    expect(leaseState.values.has(acquired.claim.leaseKey)).toBe(false);
  });

  it('treats legacy boolean claims as completed without changing their TTL or reexecuting', async () => {
    const { consumer, chat, chatMessageService, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const subject = consumer as any;

    const legacyEvent = {
      ...makeTextUpsert('Oi legado'),
      event_id: 'waevt_v1_legacy-boolean-lock',
    };
    const legacyKey = subject.getAutomationDedupeKey(
      legacyEvent,
      'outside_hours',
      `event:${legacyEvent.event_id}`
    );
    leaseState.values.set(legacyKey, '1');
    leaseState.ttls.set(legacyKey, 86_400);
    await expect(
      subject.acquireAutomationSendAttempt(legacyEvent, 'outside_hours')
    ).resolves.toEqual({ status: 'completed' });
    expect(leaseState.values.get(legacyKey)).toBe('1');
    expect(leaseState.ttls.get(legacyKey)).toBe(86_400);

    await expect(
      subject.sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        legacyEvent,
        chat,
        'Estamos fora do horário'
      )
    ).resolves.toBeUndefined();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(leaseState.values.get(legacyKey)).toBe('1');
    expect(leaseState.ttls.get(legacyKey)).toBe(86_400);
  });

  it('renews a processing claim with periodic compare-and-expire heartbeats while its operation is running', async () => {
    jest.useFakeTimers();

    try {
      const { consumer, redis } = makeConsumer();
      const leaseState = installAutomationLeaseState(redis);
      const sourceEvent = {
        ...makeTextUpsert('Operação longa'),
        event_id: 'waevt_v1_periodic-heartbeat',
      };
      const subject = consumer as any;
      const acquired = await subject.acquireAutomationSendAttempt(
        sourceEvent,
        'chatbot_flow'
      );
      let finishOperation!: () => void;
      let markOperationStarted!: () => void;
      const operationStarted = new Promise<void>((resolve) => {
        markOperationStarted = resolve;
      });
      const operation = subject.runAutomationSendAttempt(
        acquired.claim,
        async (assertActive: () => Promise<void>) => {
          await assertActive();
          markOperationStarted();
          await new Promise<void>((resolve) => {
            finishOperation = resolve;
          });
          await assertActive();
          return 'completed';
        }
      );

      await operationStarted;
      const heartbeatCallCount = () =>
        redis.eval.mock.calls.filter(([script]) =>
          String(script).includes('automation_send_heartbeat_v2')
        ).length;
      const heartbeatsBeforeInterval = heartbeatCallCount();
      leaseState.ttls.set(acquired.claim.leaseKey, 1);

      await jest.advanceTimersByTimeAsync(100_000);

      expect(heartbeatCallCount()).toBeGreaterThan(heartbeatsBeforeInterval);
      expect(leaseState.ttls.get(acquired.claim.leaseKey)).toBe(300);

      finishOperation();
      await expect(operation).resolves.toBe('completed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops renewing and quarantines the claim when the upstream Kafka guard is revoked', async () => {
    jest.useFakeTimers();

    try {
      const { consumer, redis } = makeConsumer();
      const leaseState = installAutomationLeaseState(redis);
      const sourceEvent = {
        ...makeTextUpsert('Operação suspensa'),
        event_id: 'waevt_v1_revoked-heartbeat',
      };
      const subject = consumer as any;
      const acquired = await subject.acquireAutomationSendAttempt(
        sourceEvent,
        'chatbot_flow'
      );
      let revoked = false;
      const upstreamAssertActive = jest.fn(async () => {
        if (revoked) {
          throw new Error('Kafka consumer assignment was revoked');
        }
      });
      let resumeOperation!: () => void;
      let markOperationStarted!: () => void;
      const operationStarted = new Promise<void>((resolve) => {
        markOperationStarted = resolve;
      });
      const effect = jest.fn();
      const operation = runWithKafkaDispatchGuard(upstreamAssertActive, () =>
        subject.runAutomationSendAttempt(
          acquired.claim,
          async (assertActive: () => Promise<void>) => {
            markOperationStarted();
            await new Promise<void>((resolve) => {
              resumeOperation = resolve;
            });
            await assertActive();
            effect();
          }
        )
      );

      await operationStarted;
      const scriptCallCount = (marker: string) =>
        redis.eval.mock.calls.filter(([script]) =>
          String(script).includes(marker)
        ).length;
      const heartbeatCallsBeforeRevocation = scriptCallCount(
        'automation_send_heartbeat_v2'
      );

      revoked = true;
      await jest.advanceTimersByTimeAsync(100_000);

      expect(scriptCallCount('automation_send_heartbeat_v2')).toBe(
        heartbeatCallsBeforeRevocation
      );
      const upstreamCallsAfterRevocation =
        upstreamAssertActive.mock.calls.length;

      await jest.advanceTimersByTimeAsync(100_000);

      expect(scriptCallCount('automation_send_heartbeat_v2')).toBe(
        heartbeatCallsBeforeRevocation
      );
      expect(upstreamAssertActive).toHaveBeenCalledTimes(
        upstreamCallsAfterRevocation
      );

      resumeOperation();
      await expect(operation).rejects.toThrow(
        'Kafka consumer assignment was revoked'
      );
      expect(effect).not.toHaveBeenCalled();
      expect(leaseState.values.get(acquired.claim.leaseKey)).toBe(
        acquired.claim.ownerValue
      );
      expect(scriptCallCount('automation_send_release_v2')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fences later chatbot message effects after ownership loss and preserves the deterministic execution on retry', async () => {
    const { consumer, chat, chatbotFlowRunnerService, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Iniciar fluxo com duas mensagens'),
      event_id: 'waevt_v1_multi-message-lease',
    };
    chatbotFlowRunnerService.canTriggerChatbotEvent.mockResolvedValue(true);
    Object.assign(consumer, {
      ensureChatAndHandleMessage: jest.fn(async () => chat),
    });
    const execute = chatbotFlowRunnerService.execute as jest.Mock<
      Promise<string | null | undefined>,
      unknown[]
    >;
    const effects: string[] = [];
    let firstExecutionId: string | undefined;

    execute.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[5] as {
        assertActive: () => Promise<void>;
        executionId: string;
      };
      firstExecutionId = options.executionId;
      await options.assertActive();
      effects.push('message-0');

      const processingEntry = [...leaseState.values.entries()].find(([key]) =>
        key.startsWith('automation-send:processing:v2:')
      );
      expect(processingEntry).toBeDefined();
      if (!processingEntry) {
        throw new Error('processing lease was not created');
      }
      leaseState.values.set(
        processingEntry[0],
        '{"state":"processing","token":"competing-owner"}'
      );

      await options.assertActive();
      effects.push('message-1');
      return 'flow-node-1';
    });

    await expect(
      (consumer as any).createOrUpdateChatBotFlow(
        (key: string) => key,
        chat,
        sourceEvent,
        'chatbot-1'
      )
    ).rejects.toThrow('lease ownership was lost');
    expect(effects).toEqual(['message-0']);
    expect(firstExecutionId).toEqual(expect.any(String));

    leaseState.values.clear();
    leaseState.ttls.clear();
    execute.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[5] as {
        assertActive: () => Promise<void>;
        executionId: string;
      };
      expect(options.executionId).toBe(firstExecutionId);
      await options.assertActive();
      effects.push('message-0-replay');
      await options.assertActive();
      effects.push('message-1-replay');
      return 'flow-node-1';
    });

    await expect(
      (consumer as any).createOrUpdateChatBotFlow(
        (key: string) => key,
        chat,
        sourceEvent,
        'chatbot-1'
      )
    ).resolves.toBe('flow-node-1');
    expect(effects).toEqual([
      'message-0',
      'message-0-replay',
      'message-1-replay',
    ]);
  });

  it('passes the ownership guard into the outside-hours send boundary', async () => {
    const { consumer, chat, chatMessageService, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const effect = jest.fn();
    chatMessageService.sendMessage.mockImplementation(
      async (...args: unknown[]) => {
        const options = args[1] as { assertActive: () => Promise<void> };
        expect(options.assertActive).toEqual(expect.any(Function));
        const processingEntry = [...leaseState.values.entries()].find(([key]) =>
          key.startsWith('automation-send:processing:v2:')
        );
        expect(processingEntry).toBeDefined();
        if (!processingEntry) {
          throw new Error('processing lease was not created');
        }
        leaseState.values.set(
          processingEntry[0],
          '{"state":"processing","token":"competing-owner"}'
        );
        await options.assertActive();
        effect();
        return true;
      }
    );

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        {
          ...makeTextUpsert('Oi'),
          event_id: 'waevt_v1_outside-hours-effect-fence',
        },
        chat,
        'Estamos fora do horário'
      )
    ).rejects.toThrow('lease ownership was lost');
    expect(effect).not.toHaveBeenCalled();
  });

  it('never releases or completes an automation lease owned by another consumer', async () => {
    const { consumer, redis } = makeConsumer();
    const leaseState = installAutomationLeaseState(redis);
    const sourceEvent = {
      ...makeTextUpsert('Oi'),
      event_id: 'waevt_v1_lease-ownership',
    };
    const subject = consumer as any;
    const acquired = await subject.acquireAutomationSendAttempt(
      sourceEvent,
      'outside_hours'
    );
    const competingOwner = '{"state":"processing","token":"competing-owner"}';
    leaseState.values.set(acquired.claim.leaseKey, competingOwner);

    await expect(
      subject.releaseAutomationSendAttempt(acquired.claim)
    ).resolves.toBe(false);
    await expect(
      subject.completeAutomationSendAttempt(acquired.claim)
    ).rejects.toThrow('lease ownership was lost');
    expect(leaseState.values.get(acquired.claim.leaseKey)).toBe(competingOwner);
  });

  it('propagates Redis acquisition failures instead of treating automation as deduplicated', async () => {
    const { consumer, chat, chatMessageService, redis } = makeConsumer();
    redis.eval.mockRejectedValueOnce(new Error('redis_unavailable'));

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        {
          ...makeTextUpsert('Oi'),
          event_id: 'waevt_v1_redis-unavailable',
        },
        chat,
        'Estamos fora do horário'
      )
    ).rejects.toThrow('redis_unavailable');
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when an automation source has no stable physical identity', async () => {
    const { consumer, chat, chatMessageService } = makeConsumer();
    const sourceWithoutIdentity = makeTextUpsert('Oi');
    sourceWithoutIdentity.event_id = undefined;
    if (sourceWithoutIdentity.message?.key) {
      sourceWithoutIdentity.message.key.id = undefined;
    }

    await expect(
      (consumer as any).sendOutsideHoursMessageWithDebounce(
        (key: string) => key,
        sourceWithoutIdentity,
        chat,
        'Estamos fora do horário'
      )
    ).rejects.toThrow('has no stable source identity');
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('delegates a closed outside-hours message to the durable finish outbox', async () => {
    const { consumer, chat, chatService, chatbotFlowRunnerService } =
      makeConsumer();
    chatService.findChatByPhone.mockResolvedValueOnce(chat);
    const subject = consumer as unknown as {
      createOrUpdateChatQueue: jest.Mock;
      handleOutsideHoursMessageOnly: (
        t: (key: string) => string,
        data: IUpsertMessage,
        currentChat: IChat | null,
        phone: string,
        jid: string,
        jidAlt: string,
        context: {
          attendance_hours: {
            message_only_destination_status: 'closed';
          };
          outside_hours_message: string;
        }
      ) => Promise<void>;
    };
    subject.createOrUpdateChatQueue = jest.fn(async () => undefined);

    await subject.handleOutsideHoursMessageOnly(
      (key: string) => key,
      makeTextUpsert(),
      chat,
      '6999715039',
      phoneJid,
      lidJid,
      {
        attendance_hours: { message_only_destination_status: 'closed' },
        outside_hours_message: 'Estamos fora do horário',
      }
    );

    expect(
      chatbotFlowRunnerService.finishOutsideHoursChat
    ).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      'Estamos fora do horário'
    );
  });

  it('does not continue when the outside-hours outbox rejects ownership', async () => {
    const {
      consumer,
      chat,
      chatService,
      chatMessageService,
      chatbotFlowRunnerService,
    } = makeConsumer();
    chatService.findChatByPhone.mockResolvedValueOnce(chat);
    chatbotFlowRunnerService.finishOutsideHoursChat.mockResolvedValueOnce(
      false
    );
    const subject = consumer as unknown as {
      createOrUpdateChatQueue: jest.Mock;
      handleOutsideHoursMessageOnly: (
        t: (key: string) => string,
        data: IUpsertMessage,
        currentChat: IChat | null,
        phone: string,
        jid: string,
        jidAlt: string,
        context: {
          attendance_hours: {
            message_only_destination_status: 'closed';
          };
          outside_hours_message: string;
        }
      ) => Promise<void>;
    };
    subject.createOrUpdateChatQueue = jest.fn(async () => undefined);

    await subject.handleOutsideHoursMessageOnly(
      (key: string) => key,
      makeTextUpsert(),
      chat,
      '6999715039',
      phoneJid,
      lidJid,
      {
        attendance_hours: { message_only_destination_status: 'closed' },
        outside_hours_message: 'Estamos fora do horário',
      }
    );

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });
});
