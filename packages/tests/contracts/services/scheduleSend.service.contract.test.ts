import 'reflect-metadata';

const mockGenerateProtocol = jest.fn(() => 'PROTO-1');

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(async () => null),
}));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/, '@s.whatsapp.net')
  ),
}));

jest.mock('@core/services/contact.service', () => ({
  ContactService: class ContactService {},
}));

jest.mock('@core/services/chatbotFlowRunner.service', () => ({
  ChatbotFlowRunnerService: class ChatbotFlowRunnerService {},
}));

jest.mock('@core/common/functions/generateProtocol', () => ({
  generateProtocol: () => mockGenerateProtocol(),
}));

jest.mock('@core/common/functions/withLock', () => ({
  LockAcquisitionTimeoutError: class LockAcquisitionTimeoutError extends Error {},
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import { ScheduleSendService } from '@core/services/scheduleSend.service';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { withLock } from '@core/common/functions/withLock';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';

describe('ScheduleSendService', () => {
  const makeService = () => {
    const schedulePendingListerRepository = {
      listPendingScheduleById: jest.fn(),
      listPendingSchedules: jest.fn(),
      viewScheduleById: jest.fn(),
    };
    const scheduleContactsValidatedListerRepository = {
      listValidatedContactsBySchedule: jest.fn(async () => []),
    };
    const scheduleStatusUpdaterRepository = {
      updateScheduleStatusIfCurrent: jest.fn(async () => true),
    };
    const contactService = {
      getContactPhoneDecrypted: jest.fn(() => ''),
      updateContactIsValided: jest.fn(async () => true),
      updateContactValidation: jest.fn(async () => true),
    };
    const phoneValidationService = {
      validatePhone: jest.fn(),
    };
    const kafkaServiceQueueService = {
      officialWhatsappSendMessage: jest.fn(
        () => 'official.whatsapp.send.message'
      ),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => undefined),
      refreshIndex: jest.fn(async () => undefined),
      createDocument: jest.fn(async () => 'created'),
      updateWithOCC: jest.fn(async () => 'updated'),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const planAccountService = {
      totalMassSendingLimitByAccountId: jest.fn(async () => 100),
      getMassSendingTotal: jest.fn(async () => 0),
    };
    const chatService = {
      findOpenChatByIdentity: jest.fn<Promise<any>, any[]>(async () => null),
      findLastMessageByChatId: jest.fn<Promise<any>, any[]>(async () => null),
      findChatByChatId: jest.fn<Promise<any>, any[]>(async () => null),
      ensureProtocolForNewChat: jest.fn(async (chat) => chat),
      saveChat: jest.fn<Promise<boolean>, any[]>(async () => true),
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const chatbotFlowRunnerService = {
      execute: jest.fn(async () => undefined),
      clearFlowCacheForChat: jest.fn(async () => undefined),
    };
    const encryptService = {
      sanitize: jest.fn((value: string) => value),
    };
    const workerConfigService = {
      viewSecurityKey: jest.fn(async () => ({
        enabled: true,
        schedule: true,
        chatbot: false,
        quick_message: false,
      })),
    };
    const redis = {
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const officialWhatsappTemplateService = {
      buildPreviewText: jest.fn((template, values) => {
        const body = template?.preview?.body ?? template?.name ?? '';
        return (values ?? []).reduce(
          (text: string, variable: { index: number; value: string }) =>
            text.replace(`{{${variable.index}}}`, variable.value),
          body
        );
      }),
    };
    const scheduleOfficialMessageService = {
      assertOfficialScheduleChatbotStart: jest.fn(async () => undefined),
    };
    const scheduleStatusCoordinationService = {
      currentTimeMilliseconds: jest.fn(async () => 100_500),
      queueMessageAttempt: jest.fn<
        Promise<'queued' | 'busy' | 'completed'>,
        [
          {
            scheduleId: string;
            messageId: string;
            attemptId: string;
          },
        ]
      >(async () => 'queued'),
      completeQueuedMessageAttempt: jest.fn(async () => true),
    };
    const scheduleControlRepository = {
      getScheduleStatusById: jest.fn(async () => EScheduleStatus.pending),
    };

    const service = new ScheduleSendService(
      schedulePendingListerRepository as never,
      scheduleContactsValidatedListerRepository as never,
      scheduleStatusUpdaterRepository as never,
      contactService as never,
      kafkaServiceQueueService as never,
      streamProducerService as never,
      workerCommandAdmissionService as never,
      elasticDatabaseService as never,
      planAccountService as never,
      chatService as never,
      chatbotFlowRunnerService as never,
      encryptService as never,
      phoneValidationService as never,
      scheduleControlRepository as never,
      workerConfigService as never,
      officialWhatsappTemplateService as never,
      scheduleOfficialMessageService as never,
      redis as never,
      scheduleStatusCoordinationService as never
    );

    return {
      service,
      schedulePendingListerRepository,
      scheduleContactsValidatedListerRepository,
      scheduleStatusUpdaterRepository,
      contactService,
      phoneValidationService,
      kafkaServiceQueueService,
      streamProducerService,
      workerCommandAdmissionService,
      elasticDatabaseService,
      planAccountService,
      chatService,
      chatbotFlowRunnerService,
      encryptService,
      workerConfigService,
      officialWhatsappTemplateService,
      scheduleOfficialMessageService,
      scheduleStatusCoordinationService,
      scheduleControlRepository,
      redis,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateProtocol.mockReturnValue('PROTO-1');
  });

  const runScheduleChatbot = (service: ScheduleSendService) =>
    (service as any).sendScheduleChatbot(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        account_name: 'Account',
        worker_id: 'worker-1',
        worker_name: 'Official WhatsApp',
        worker_type_id: EWorkerType.whatsapp,
        chatbot_id: 'chatbot-1',
        type: EScheduleType.chatbot,
      },
      {
        contact_id: 'contact-1',
        name: 'Contact',
        phone: null,
        phone_ddi: null,
        phone_partial: null,
        is_validated: true,
      },
      '5511999999999@s.whatsapp.net'
    );

  it('blocks non-official technical fallback for an officially assumed contact', async () => {
    const { service, contactService, phoneValidationService } = makeService();
    contactService.getContactPhoneDecrypted.mockReturnValue('11999999999');
    phoneValidationService.validatePhone.mockRejectedValue(
      new Error('unavailable')
    );

    await expect(
      (service as any).resolveChatbotValidatedJid(
        { account_id: 'account-1' },
        {
          contact_id: 'contact-1',
          name: 'Contact',
          nickname: null,
          phone: 'encrypted',
          phone_ddi: '55',
          phone_partial: '***9999',
          is_validated: true,
          validation_origin: 'official_assumed',
        },
        '5511999999999@s.whatsapp.net'
      )
    ).resolves.toBeNull();
  });

  it('promotes a successful non-official lookup to whatsapp_lookup', async () => {
    const { service, contactService, phoneValidationService } = makeService();
    contactService.getContactPhoneDecrypted.mockReturnValue('11999999999');
    phoneValidationService.validatePhone.mockResolvedValue({
      valid: true,
      phone: '5511999999999',
      jid: '5511999999999@s.whatsapp.net',
    });

    await expect(
      (service as any).resolveChatbotValidatedJid(
        { account_id: 'account-1' },
        {
          contact_id: 'contact-1',
          name: 'Contact',
          nickname: null,
          phone: 'encrypted',
          phone_ddi: '55',
          phone_partial: '***9999',
          is_validated: true,
          validation_origin: 'official_assumed',
        },
        '5511999999999@s.whatsapp.net'
      )
    ).resolves.toBe('5511999999999@s.whatsapp.net');

    expect(contactService.updateContactValidation).toHaveBeenCalledWith(
      'contact-1',
      '5511999999999',
      true,
      undefined,
      undefined,
      'whatsapp_lookup'
    );
  });

  it('reconciles an invalid official contact without remote lookup before scheduling', async () => {
    const { service, contactService, phoneValidationService } = makeService();
    contactService.getContactPhoneDecrypted.mockReturnValue('11999999999');
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    const sendScheduleChatbot = jest
      .spyOn(service as any, 'sendScheduleChatbot')
      .mockResolvedValue({ success: true, contactId: 'contact-1' });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          worker_id: 'official-1',
          worker_type_id: EWorkerType.whatsapp,
          type: EScheduleType.chatbot,
        },
        {
          contact_id: 'contact-1',
          name: 'Contact',
          nickname: null,
          phone: 'encrypted',
          phone_ddi: '55',
          phone_partial: '***9999',
          is_validated: false,
          validation_origin: null,
        }
      )
    ).resolves.toEqual({ success: true, contactId: 'contact-1' });

    expect(contactService.updateContactIsValided).toHaveBeenCalledWith(
      'contact-1',
      true,
      undefined,
      undefined,
      'official_assumed'
    );
    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
    expect(sendScheduleChatbot).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        is_validated: true,
        validation_origin: 'official_assumed',
      }),
      '5511999999999@s.whatsapp.net',
      undefined
    );
  });

  it('excludes already reprocessed failures from explicit reprocess selection', async () => {
    const { service } = makeService();
    const select = jest.fn<
      Promise<{ hits: { hits: never[] } }>,
      [string, Record<string, unknown>]
    >(async () => ({
      hits: {
        hits: [],
      },
    }));
    (service as any).elasticDatabaseService.select = select;

    await expect(
      (service as any).listFailedMessageReferences('schedule-1', 'account-1')
    ).resolves.toEqual([]);

    const query = select.mock.calls[0][1] as {
      query: {
        bool: {
          must_not: unknown[];
        };
      };
    };
    expect(query.query.bool.must_not).toEqual([
      {
        exists: {
          field: 'reprocessed_by_message_id',
        },
      },
    ]);
  });

  it('reprocesses a failed message under a new physical message id and links the historical failure before publishing', async () => {
    const { service, workerCommandAdmissionService, elasticDatabaseService } =
      makeService();
    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
      account_name: 'Underchat',
      worker_id: 'worker-1',
      worker_name: 'Canal 1',
      type: EScheduleType.text,
      message: 'Olá',
      url: null,
      send_to: 'contacts',
    };
    const contact = {
      contact_id: 'contact-1',
      name: 'John',
      phone: null,
      phone_ddi: null,
      phone_partial: null,
      is_validated: true,
    };
    const failedMessage = {
      message_id: 'failed-message-1',
      contact_id: contact.contact_id,
    };

    (service as any).schedulePendingListerRepository = {
      viewScheduleById: jest.fn(async () => schedule),
    };
    (service as any).scheduleContactsValidatedListerRepository = {
      listValidatedContactsBySchedule: jest.fn(async () => [contact]),
    };
    jest
      .spyOn(service as any, 'listFailedMessageReferences')
      .mockResolvedValue([failedMessage]);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'createChatMessage')
      .mockImplementation(async (...args: unknown[]) => {
        const messageId = args[3] as string;
        return {
          message_id: messageId,
          chat_id: 'account-1:5511999999999@s.whatsapp.net',
          worker: { id: 'worker-1' },
          content: {
            type: EMessageType.text,
            message: 'Olá',
          },
        };
      });

    await expect(
      service.reprocessScheduleMessage(
        schedule.schedule_id,
        failedMessage.message_id,
        schedule.account_id
      )
    ).resolves.toBe(true);

    const admissionCalls = workerCommandAdmissionService.admit.mock
      .calls as unknown as Array<
      [
        {
          payload: {
            message: {
              message_id: string;
            };
          };
        },
      ]
    >;
    const outboundPayload = admissionCalls[0][0].payload;
    const replacementMessageId = outboundPayload.message.message_id;
    expect(replacementMessageId).toEqual(expect.any(String));
    expect(replacementMessageId).not.toBe(failedMessage.message_id);

    const updateCalls = elasticDatabaseService.updateWithScriptOCC.mock
      .calls as unknown as Array<
      [
        string,
        string,
        {
          params: {
            account_id: string;
            contact_id: string;
            replacement_message_id: string;
            reprocessed_at: string;
          };
        },
        Record<string, unknown>,
      ]
    >;
    const historicalLinkCall = updateCalls.find(
      ([, documentId]) => documentId === failedMessage.message_id
    );
    expect(historicalLinkCall?.[2].params).toEqual(
      expect.objectContaining({
        account_id: schedule.account_id,
        contact_id: contact.contact_id,
        replacement_message_id: replacementMessageId,
        reprocessed_at: new Date(100_500).toISOString(),
      })
    );
    expect(historicalLinkCall?.[3]).toEqual(
      expect.objectContaining({
        refresh: true,
      })
    );
    expect(
      elasticDatabaseService.updateWithScriptOCC.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workerCommandAdmissionService.admit.mock.invocationCallOrder[0]
    );
  });

  it('generates a distinct new message id for every explicitly reprocessed failure', async () => {
    const { service } = makeService();
    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
      account_name: 'Underchat',
      worker_id: 'worker-1',
      worker_name: 'Canal 1',
      type: EScheduleType.text,
      message: 'Olá',
      url: null,
      send_to: 'contacts',
    };
    const contacts = [
      {
        contact_id: 'contact-1',
        name: 'John',
        phone: null,
        phone_ddi: null,
        phone_partial: null,
        is_validated: true,
      },
      {
        contact_id: 'contact-2',
        name: 'Mary',
        phone: null,
        phone_ddi: null,
        phone_partial: null,
        is_validated: true,
      },
    ];
    const failedMessages = contacts.map((contact, index) => ({
      message_id: `failed-message-${index + 1}`,
      contact_id: contact.contact_id,
    }));

    (service as any).schedulePendingListerRepository = {
      viewScheduleById: jest.fn(async () => schedule),
    };
    (service as any).scheduleContactsValidatedListerRepository = {
      listValidatedContactsBySchedule: jest.fn(async () => contacts),
    };
    jest
      .spyOn(service as any, 'listFailedMessageReferences')
      .mockImplementation(async (...args: unknown[]) => {
        const messageId = args[2] as string | undefined;
        return messageId
          ? failedMessages.filter((item) => item.message_id === messageId)
          : failedMessages;
      });
    const markSpy = jest
      .spyOn(service as any, 'markFailedMessageAsReprocessed')
      .mockResolvedValue(true);
    const sendSpy = jest
      .spyOn(service as any, 'sendScheduleMessage')
      .mockImplementation(async (...args: unknown[]) => {
        const contact = args[1] as { contact_id: string };
        return {
          success: true,
          contactId: contact.contact_id,
        };
      });

    await expect(
      service.reprocessFailedMessages(schedule.schedule_id, schedule.account_id)
    ).resolves.toEqual({
      total: 2,
      reprocessed: 2,
    });

    const replacementMessageIds = (
      sendSpy.mock.calls as unknown as Array<
        [unknown, unknown, { messageId: string }]
      >
    ).map(([, , options]) => options.messageId);
    expect(new Set(replacementMessageIds).size).toBe(2);
    for (const replacementMessageId of replacementMessageIds) {
      expect(
        failedMessages.some(
          (failedMessage) => failedMessage.message_id === replacementMessageId
        )
      ).toBe(false);
    }
    expect(markSpy).toHaveBeenNthCalledWith(
      1,
      schedule.schedule_id,
      schedule.account_id,
      failedMessages[0].contact_id,
      failedMessages[0].message_id,
      replacementMessageIds[0]
    );
    expect(markSpy).toHaveBeenNthCalledWith(
      2,
      schedule.schedule_id,
      schedule.account_id,
      failedMessages[1].contact_id,
      failedMessages[1].message_id,
      replacementMessageIds[1]
    );
  });

  it('does not dispatch when the historical failure was already claimed by another pod', async () => {
    const { service } = makeService();
    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
    };
    const contact = {
      contact_id: 'contact-1',
    };
    const failedMessage = {
      message_id: 'failed-message-1',
      contact_id: contact.contact_id,
    };
    jest
      .spyOn(service as any, 'listFailedMessageReferences')
      .mockResolvedValue([failedMessage]);
    jest
      .spyOn(service as any, 'markFailedMessageAsReprocessed')
      .mockResolvedValue(false);
    const sendSpy = jest.spyOn(service as any, 'sendScheduleMessage');

    await expect(
      (service as any).reprocessFailedMessageReference(
        schedule,
        contact,
        failedMessage
      )
    ).resolves.toBeNull();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('persists a new attempt and resets stale status identity on reprocess', async () => {
    const { service, elasticDatabaseService } = makeService();
    elasticDatabaseService.createDocument.mockResolvedValueOnce('conflict');

    await expect(
      (service as any).saveToElasticsearch(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        },
        {
          message_id: 'message-1',
          content: {
            type: EMessageType.text,
            message: 'Olá',
          },
        },
        EScheduleStatus.processing,
        {
          overrideOnConflict: true,
          attemptId: 'attempt-2',
          resetStatusIdentity: true,
        }
      )
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      'schedule',
      'message-1',
      expect.objectContaining({
        schedule_id: 'schedule-1',
        attempt_id: 'attempt-2',
        status: EScheduleStatus.processing,
        updated_at_epoch_millis: expect.any(Number),
        last_event_id: null,
        last_event_sort_key: null,
        status_rank: null,
      }),
      {
        upsert: true,
        maxRetries: 5,
      }
    );
  });

  it('claims the queued attempt before persisting and publishing it', async () => {
    const {
      service,
      elasticDatabaseService,
      workerCommandAdmissionService,
      scheduleStatusCoordinationService,
    } = makeService();
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest.spyOn(service as any, 'createChatMessage').mockResolvedValue({
      message_id: 'message-1',
      chat_id: '5511999999999@s.whatsapp.net',
      worker: { id: 'worker-1' },
      content: {
        type: EMessageType.text,
        message: 'Olá',
      },
    });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toEqual({
      success: true,
      contactId: 'contact-1',
    });

    const attemptId =
      scheduleStatusCoordinationService.queueMessageAttempt.mock.calls[0][0]
        .attemptId;
    expect(attemptId).toEqual(expect.any(String));
    expect(
      scheduleStatusCoordinationService.queueMessageAttempt
    ).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: 'message-1',
      attemptId,
    });
    expect(elasticDatabaseService.createDocument).toHaveBeenCalledWith(
      'schedule',
      'message-1',
      expect.objectContaining({
        attempt_id: attemptId,
        status: EScheduleStatus.processing,
        last_event_id: null,
        last_event_sort_key: null,
        status_rank: null,
      })
    );
    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'schedule_send',
      entityKey: 'chat:account-1:worker-1:5511999999999@s.whatsapp.net',
      operationId: attemptId,
      scheduleProjection: {
        schedule_id: 'schedule-1',
        message_id: 'message-1',
        attempt_id: attemptId,
      },
      payload: expect.objectContaining({
        schedule_id: 'schedule-1',
        attempt_id: attemptId,
        contact_id: 'contact-1',
      }),
      source: 'schedule',
    });
    expect(
      scheduleStatusCoordinationService.queueMessageAttempt.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      elasticDatabaseService.createDocument.mock.invocationCallOrder[0]
    );
    expect(
      elasticDatabaseService.createDocument.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workerCommandAdmissionService.admit.mock.invocationCallOrder[0]
    );
  });

  it('does not persist or publish when another attempt is active', async () => {
    const {
      service,
      elasticDatabaseService,
      workerCommandAdmissionService,
      scheduleStatusCoordinationService,
    } = makeService();
    scheduleStatusCoordinationService.queueMessageAttempt.mockResolvedValue(
      'busy'
    );
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest.spyOn(service as any, 'createChatMessage').mockResolvedValue({
      message_id: 'message-1',
      chat_id: '5511999999999@s.whatsapp.net',
      worker: { id: 'worker-1' },
      content: {
        type: EMessageType.text,
        message: 'Olá',
      },
    });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toEqual({
      success: false,
      contactId: 'contact-1',
    });

    expect(elasticDatabaseService.indices).not.toHaveBeenCalled();
    expect(elasticDatabaseService.createDocument).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).not.toHaveBeenCalled();
  });

  it('leaves the queued claim recoverable if initial persistence fails', async () => {
    const {
      service,
      elasticDatabaseService,
      workerCommandAdmissionService,
      scheduleStatusCoordinationService,
    } = makeService();
    elasticDatabaseService.createDocument.mockRejectedValueOnce(
      new Error('elasticsearch unavailable')
    );
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest.spyOn(service as any, 'createChatMessage').mockResolvedValue({
      message_id: 'message-1',
      chat_id: '5511999999999@s.whatsapp.net',
      worker: { id: 'worker-1' },
      content: {
        type: EMessageType.text,
        message: 'Olá',
      },
    });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toEqual({
      success: false,
      contactId: 'contact-1',
    });

    expect(
      scheduleStatusCoordinationService.completeQueuedMessageAttempt
    ).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).not.toHaveBeenCalled();
  });

  it('persists a terminal failure before completing the queued claim', async () => {
    const {
      service,
      elasticDatabaseService,
      workerCommandAdmissionService,
      scheduleStatusCoordinationService,
    } = makeService();
    elasticDatabaseService.createDocument
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('conflict');
    workerCommandAdmissionService.admit.mockRejectedValueOnce(
      new Error('jetstream unavailable')
    );
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest.spyOn(service as any, 'createChatMessage').mockResolvedValue({
      message_id: 'message-1',
      chat_id: '5511999999999@s.whatsapp.net',
      worker: { id: 'worker-1' },
      content: {
        type: EMessageType.text,
        message: 'Olá',
      },
    });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toEqual({
      success: false,
      contactId: 'contact-1',
    });

    const attemptId =
      scheduleStatusCoordinationService.queueMessageAttempt.mock.calls[0][0]
        .attemptId;
    expect(elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      'schedule',
      'message-1',
      expect.objectContaining({
        attempt_id: attemptId,
        status: EScheduleStatus.failed,
      }),
      {
        upsert: true,
        maxRetries: 5,
      }
    );
    expect(
      scheduleStatusCoordinationService.completeQueuedMessageAttempt
    ).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      attemptId,
    });
    expect(
      elasticDatabaseService.updateWithOCC.mock.invocationCallOrder[0]
    ).toBeLessThan(
      scheduleStatusCoordinationService.completeQueuedMessageAttempt.mock
        .invocationCallOrder[0]
    );
  });

  it('does not complete a queued claim when terminal persistence is not confirmed', async () => {
    const {
      service,
      elasticDatabaseService,
      workerCommandAdmissionService,
      scheduleStatusCoordinationService,
    } = makeService();
    elasticDatabaseService.createDocument
      .mockResolvedValueOnce('created')
      .mockRejectedValueOnce(new Error('elasticsearch unavailable'));
    workerCommandAdmissionService.admit.mockRejectedValueOnce(
      new Error('jetstream unavailable')
    );
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest.spyOn(service as any, 'checkAndSetDuplicate').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'validateContactPhone')
      .mockResolvedValue('5511999999999@s.whatsapp.net');
    jest.spyOn(service as any, 'checkMassSendingLimit').mockResolvedValue(true);
    jest.spyOn(service as any, 'createChatMessage').mockResolvedValue({
      message_id: 'message-1',
      chat_id: '5511999999999@s.whatsapp.net',
      worker: { id: 'worker-1' },
      content: {
        type: EMessageType.text,
        message: 'Olá',
      },
    });

    await expect(
      (service as any).sendScheduleMessage(
        {
          schedule_id: 'schedule-1',
          account_id: 'account-1',
          account_name: 'Underchat',
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          type: EScheduleType.text,
          message: 'Olá',
          url: null,
        },
        {
          contact_id: 'contact-1',
          name: 'John',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toEqual({
      success: false,
      contactId: 'contact-1',
    });

    expect(
      scheduleStatusCoordinationService.completeQueuedMessageAttempt
    ).not.toHaveBeenCalled();
  });

  it('replaces nickname with contact nickname when available', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Olá {{ nickname }} / {{ name }} / {{ protocol }}',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: 'Johnny',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Olá Johnny / John / PROTO-1');
  });

  it('falls back from nickname to contact name', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Olá {{ nickname }}',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: null,
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Olá John');
  });

  it('keeps messages without nickname unchanged', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Mensagem fixa',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: 'Johnny',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Mensagem fixa');
  });

  it('admits schedule commands keyed by account, worker and chat', async () => {
    const { service, workerCommandAdmissionService } = makeService();

    await (service as any).sendMessageToKafka(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
      },
      {
        contact_id: 'contact-1',
        is_validated: true,
      },
      {
        message_id: 'message-1',
        chat_id: 'chat-1',
        worker: { id: 'worker-1' },
      },
      'attempt-1'
    );

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'schedule_send',
      entityKey: 'chat:account-1:worker-1:chat-1',
      operationId: 'attempt-1',
      scheduleProjection: {
        schedule_id: 'schedule-1',
        message_id: 'message-1',
        attempt_id: 'attempt-1',
      },
      payload: expect.objectContaining({
        schedule_id: 'schedule-1',
        attempt_id: 'attempt-1',
        contact_id: 'contact-1',
        message: expect.objectContaining({
          message_id: 'message-1',
        }),
      }),
      source: 'schedule',
    });
  });

  it('publishes official schedule messages to the official Meta topic', async () => {
    const { service, streamProducerService } = makeService();

    await (service as any).sendMessageToKafka(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
      },
      {
        contact_id: 'contact-1',
        is_validated: true,
      },
      {
        message_id: 'message-1',
        chat_id: 'chat-1',
        worker: { id: 'worker-1' },
      },
      'attempt-1'
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.send.message',
      expect.objectContaining({
        schedule_id: 'schedule-1',
        attempt_id: 'attempt-1',
        contact_id: 'contact-1',
        message: expect.objectContaining({
          message_id: 'message-1',
        }),
      }),
      'chat:account-1:worker-1:chat-1'
    );
  });

  it('replaces tags inside official template variables before sending', async () => {
    const { service } = makeService();
    const baseMessage = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      content: null,
    };

    const message = await (service as any).createOfficialTemplateMessage(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        account_name: 'Account',
        worker_id: 'worker-1',
        worker_name: 'Official',
        official_template: {
          name: 'abertura',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'MARKETING',
          components: [],
          preview: {
            body: 'Olá {{1}}',
          },
          variables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              value: '{{ name }}',
            },
          ],
        },
      },
      baseMessage,
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        nickname: null,
        phone: null,
        phone_ddi: null,
        phone_partial: null,
        is_validated: true,
      }
    );

    expect(message.content).toEqual(
      expect.objectContaining({
        type: EMessageType.official_template,
        message: 'Olá Maycon',
        official_template: expect.objectContaining({
          variables: [
            expect.objectContaining({
              key: 'BODY:1',
              value: 'Maycon',
            }),
          ],
        }),
      })
    );
  });

  it('preserves named parameters and sends numeric and tagged values as canonical text', async () => {
    const { service, streamProducerService } = makeService();
    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
      account_name: 'Account',
      worker_id: 'worker-1',
      worker_name: 'Official',
      worker_type_id: EWorkerType.whatsapp,
      official_template: {
        name: 'payment_update',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [],
        preview: {
          body: 'Olá {{customer_name}}, o valor atualizado é {{amount}}.',
        },
        variables: [
          {
            key: 'BODY:customer_name',
            component_type: 'BODY',
            index: 1,
            parameter_name: 'customer_name',
            value: '{{ name }}',
          },
          {
            key: 'BODY:amount',
            component_type: 'BODY',
            index: 2,
            parameter_name: 'amount',
            value: 42,
          },
        ],
      },
    };
    const contact = {
      contact_id: 'contact-1',
      name: 'Maycon',
      nickname: null,
      phone: null,
      phone_ddi: null,
      phone_partial: null,
      is_validated: true,
    };

    const message = await (service as any).createOfficialTemplateMessage(
      schedule,
      {
        message_id: 'message-1',
        chat_id: 'chat-1',
        worker: { id: 'worker-1' },
        content: null,
      },
      contact
    );

    expect(message.content).toEqual(
      expect.objectContaining({
        type: EMessageType.official_template,
        official_template: expect.objectContaining({
          parameter_format: 'NAMED',
          variables: [
            expect.objectContaining({
              key: 'BODY:customer_name',
              parameter_name: 'customer_name',
              value: 'Maycon',
            }),
            expect.objectContaining({
              key: 'BODY:amount',
              parameter_name: 'amount',
              value: '42',
            }),
          ],
        }),
      })
    );

    await (service as any).sendMessageToKafka(
      schedule,
      contact,
      message,
      'attempt-1'
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.send.message',
      expect.objectContaining({
        message: expect.objectContaining({
          content: expect.objectContaining({
            official_template: expect.objectContaining({
              parameter_format: 'NAMED',
              variables: [
                expect.objectContaining({
                  parameter_name: 'customer_name',
                  value: 'Maycon',
                }),
                expect.objectContaining({
                  parameter_name: 'amount',
                  value: '42',
                }),
              ],
            }),
          }),
        }),
      }),
      'chat:account-1:worker-1:chat-1'
    );
  });

  it('does not wait for send speed when processing official schedules', async () => {
    const { service } = makeService();
    const waitSpy = jest
      .spyOn(service as any, 'waitForDispatchWindow')
      .mockResolvedValue(true);
    jest.spyOn(service as any, 'checkMessageSent').mockResolvedValue(false);
    jest
      .spyOn(service as any, 'canContinueScheduleProcessing')
      .mockResolvedValue(true);
    const sendSpy = jest
      .spyOn(service as any, 'sendScheduleMessage')
      .mockResolvedValue({ success: true, contactId: 'contact-1' });

    await (service as any).processContactsWithControl(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
        send_speed: 'high',
        type: EScheduleType.official_template,
      },
      [
        {
          contact_id: 'contact-1',
          is_validated: true,
        },
      ]
    );

    expect(waitSpy).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ schedule_id: 'schedule-1' }),
      expect.objectContaining({ contact_id: 'contact-1' }),
      { skipAlreadySentCheck: true }
    );
  });

  it('does not append security key for official schedules and skips config lookup', async () => {
    const { service, workerConfigService } = makeService();

    await expect(
      (service as any).appendScheduleSecurityKey(
        {
          schedule_id: 'schedule-1',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.whatsapp,
        },
        'Mensagem agendada',
        { allowSecurityKeyOnly: true }
      )
    ).resolves.toBe('Mensagem agendada');

    await expect(
      (service as any).appendScheduleSecurityKey(
        {
          schedule_id: 'schedule-1',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.whatsapp,
        },
        '',
        { allowSecurityKeyOnly: true }
      )
    ).resolves.toBe('');

    expect(workerConfigService.viewSecurityKey).not.toHaveBeenCalled();
  });

  it('keeps appending security key for non-official schedules when enabled', async () => {
    const { service, workerConfigService } = makeService();

    await expect(
      (service as any).appendScheduleSecurityKey(
        {
          schedule_id: 'schedule-1',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.baileys,
        },
        'Mensagem agendada'
      )
    ).resolves.toMatch(
      /^Mensagem agendada\n\n> ```Chave de segurança: [A-Z0-9]{10}```$/
    );

    expect(workerConfigService.viewSecurityKey).toHaveBeenCalledWith(
      'worker-1'
    );
  });

  it('propagates official worker metadata to schedule messages and chatbot chats', () => {
    const { service } = makeService();
    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
      account_name: 'Account',
      worker_id: 'worker-1',
      worker_name: 'Official WhatsApp',
      worker_type_id: EWorkerType.whatsapp,
      chatbot_id: 'chatbot-1',
      type: 'chatbot',
      message: null,
      url: null,
    };
    const contact = {
      contact_id: 'contact-1',
      name: 'Contact',
      phone: null,
      phone_ddi: null,
      phone_partial: null,
      is_validated: true,
    };

    const message = (service as any).createBaseMessage(
      schedule,
      contact,
      '5511999999999@s.whatsapp.net',
      'message-1'
    );
    const chat = (service as any).buildScheduleChatbotChat(
      schedule,
      contact,
      '5511999999999@s.whatsapp.net',
      '2026-07-01T00:00:00.000Z'
    );

    expect(message.worker).toEqual({
      id: 'worker-1',
      name: 'Official WhatsApp',
      type_id: EWorkerType.whatsapp,
      is_official: true,
    });
    expect(chat.worker).toEqual({
      id: 'worker-1',
      name: 'Official WhatsApp',
      type_id: EWorkerType.whatsapp,
      is_official: true,
    });
  });

  it('validates an official chatbot flow before loading contacts or creating a chat', async () => {
    const {
      service,
      scheduleContactsValidatedListerRepository,
      scheduleStatusUpdaterRepository,
      scheduleOfficialMessageService,
      chatService,
    } = makeService();
    scheduleOfficialMessageService.assertOfficialScheduleChatbotStart.mockRejectedValue(
      new Error('official_template_variables_required')
    );

    const schedule = {
      schedule_id: 'schedule-1',
      account_id: 'account-1',
      account_name: 'Account',
      worker_id: 'worker-1',
      worker_name: 'Official WhatsApp',
      worker_type_id: EWorkerType.whatsapp,
      chatbot_id: 'chatbot-1',
      chatbot_name: 'Bot',
      type: EScheduleType.chatbot,
      send_to: 'contacts',
      send_speed: 'low',
      message: null,
      url: null,
    };

    await expect(
      (service as any).processSingleSchedule(schedule)
    ).rejects.toThrow('official_template_variables_required');

    expect(
      scheduleOfficialMessageService.assertOfficialScheduleChatbotStart
    ).toHaveBeenCalledTimes(1);
    expect(
      scheduleOfficialMessageService.assertOfficialScheduleChatbotStart
    ).toHaveBeenCalledWith({
      t: expect.any(Function),
      accountId: 'account-1',
      workerId: 'worker-1',
      chatbotId: 'chatbot-1',
    });
    expect(
      scheduleContactsValidatedListerRepository.listValidatedContactsBySchedule
    ).not.toHaveBeenCalled();
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(
      scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent
    ).toHaveBeenNthCalledWith(1, 'schedule-1', EScheduleStatus.processing, [
      EScheduleStatus.pending,
      EScheduleStatus.processing,
    ]);
    expect(
      scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent
    ).toHaveBeenNthCalledWith(2, 'schedule-1', EScheduleStatus.failed, [
      EScheduleStatus.processing,
    ]);
  });

  it('closes an empty newly-created chat when the schedule chatbot runner fails', async () => {
    const {
      service,
      elasticDatabaseService,
      chatService,
      chatbotFlowRunnerService,
    } = makeService();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    chatbotFlowRunnerService.execute.mockRejectedValue(
      new Error('template rendering failed')
    );
    chatService.findChatByChatId.mockImplementation(
      async (_accountId: string, chatId: string) => ({
        chat_id: chatId,
        account: { id: 'account-1', name: 'Account' },
        worker: { id: 'worker-1', name: 'Official WhatsApp' },
        phone: '5511999999999',
        status: EChatStatus.ura_schedule,
        date: '2026-07-24T17:00:00.000Z',
        summary: { revision: 0, last_message_id: null },
      })
    );

    try {
      await expect(runScheduleChatbot(service)).resolves.toEqual({
        success: false,
        contactId: 'contact-1',
      });
    } finally {
      consoleError.mockRestore();
    }

    const createdChat = chatService.saveChat.mock.calls.at(0)?.[0];
    expect(createdChat).toBeDefined();
    if (!createdChat) {
      throw new Error('Expected the schedule chatbot chat to be created');
    }
    expect(elasticDatabaseService.refreshIndex).toHaveBeenCalledWith('message');
    expect(chatService.findLastMessageByChatId).toHaveBeenCalledWith(
      'account-1',
      createdChat.chat_id
    );
    expect(chatService.findChatByChatId).toHaveBeenCalledWith(
      'account-1',
      createdChat.chat_id
    );
    expect(chatService.saveChat).toHaveBeenCalledTimes(2);
    expect(chatService.saveChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chat_id: createdChat.chat_id,
        status: EChatStatus.closed,
        closed_at: expect.any(String),
      }),
      expect.objectContaining({
        refresh: true,
        expectedCurrentStatuses: [EChatStatus.ura_schedule],
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: null,
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 0,
        outboundWebhook: expect.objectContaining({
          eventTypes: ['chat.automation.finished', 'chat.closed'],
          source: 'schedule_chatbot_compensation',
          previousChat: expect.objectContaining({
            status: EChatStatus.ura_schedule,
          }),
          changes: expect.objectContaining({
            reason: 'chatbot_start_failed_before_first_message',
          }),
        }),
      })
    );
    expect(chatService.invalidateChatCache).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: createdChat.chat_id,
        status: EChatStatus.closed,
      })
    );
    expect(chatbotFlowRunnerService.clearFlowCacheForChat).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      createdChat.chat_id
    );
    expect(
      elasticDatabaseService.refreshIndex.mock.invocationCallOrder[0]
    ).toBeLessThan(
      chatService.findLastMessageByChatId.mock.invocationCallOrder[0]
    );
    expect(
      chatService.findLastMessageByChatId.mock.invocationCallOrder[0]
    ).toBeLessThan(chatService.findChatByChatId.mock.invocationCallOrder[0]);
    expect(
      chatService.findChatByChatId.mock.invocationCallOrder[0]
    ).toBeLessThan(chatService.saveChat.mock.invocationCallOrder[1]);
  });

  it('does not close a failed schedule chatbot chat when a message already exists', async () => {
    const { service, chatService, chatbotFlowRunnerService } = makeService();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    chatbotFlowRunnerService.execute.mockRejectedValue(
      new Error('runner failed after sending')
    );
    chatService.findLastMessageByChatId.mockResolvedValue({
      message_id: 'message-1',
    });

    try {
      await expect(runScheduleChatbot(service)).resolves.toEqual({
        success: false,
        contactId: 'contact-1',
      });
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }

    expect(chatService.saveChat).toHaveBeenCalledTimes(1);
    expect(chatService.findChatByChatId).not.toHaveBeenCalled();
    expect(chatService.invalidateChatCache).not.toHaveBeenCalled();
    expect(
      chatbotFlowRunnerService.clearFlowCacheForChat
    ).not.toHaveBeenCalled();
  });

  it('does not close a failed schedule chatbot chat when the message check fails', async () => {
    const { service, chatService, chatbotFlowRunnerService } = makeService();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    chatbotFlowRunnerService.execute.mockRejectedValue(
      new Error('runner failed')
    );
    chatService.findLastMessageByChatId.mockRejectedValue(
      new Error('elasticsearch search unavailable')
    );

    try {
      await expect(runScheduleChatbot(service)).resolves.toEqual({
        success: false,
        contactId: 'contact-1',
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(chatService.saveChat).toHaveBeenCalledTimes(1);
    expect(chatService.findChatByChatId).not.toHaveBeenCalled();
    expect(chatService.invalidateChatCache).not.toHaveBeenCalled();
    expect(
      chatbotFlowRunnerService.clearFlowCacheForChat
    ).not.toHaveBeenCalled();
  });

  it('does not clear caches when the empty-chat close loses its CAS race', async () => {
    const { service, chatService, chatbotFlowRunnerService } = makeService();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    chatbotFlowRunnerService.execute.mockRejectedValue(
      new Error('runner failed')
    );
    chatService.findChatByChatId.mockImplementation(
      async (_accountId: string, chatId: string) => ({
        chat_id: chatId,
        account: { id: 'account-1', name: 'Account' },
        worker: { id: 'worker-1', name: 'Official WhatsApp' },
        phone: '5511999999999',
        status: EChatStatus.ura_schedule,
        date: '2026-07-24T17:00:00.000Z',
        summary: { revision: 0, last_message_id: null },
      })
    );
    chatService.saveChat
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    try {
      await expect(runScheduleChatbot(service)).resolves.toEqual({
        success: false,
        contactId: 'contact-1',
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(chatService.saveChat).toHaveBeenCalledTimes(2);
    expect(chatService.saveChat.mock.calls.at(1)?.[1]).toEqual(
      expect.objectContaining({
        expectedCurrentStatuses: [EChatStatus.ura_schedule],
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: null,
      })
    );
    expect(chatService.invalidateChatCache).not.toHaveBeenCalled();
    expect(
      chatbotFlowRunnerService.clearFlowCacheForChat
    ).not.toHaveBeenCalled();
  });

  it('rechecks chat identity inside the schedule chatbot lock before creating', async () => {
    const {
      service,
      chatService,
      chatbotFlowRunnerService,
      elasticDatabaseService,
    } = makeService();
    const existingChat = { chat_id: 'chat-existing' };
    chatService.findOpenChatByIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingChat);
    const withLockMock = jest.mocked(withLock);
    withLockMock.mockClear();

    const result = await (service as any).sendScheduleChatbot(
      {
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        account_name: 'Account',
        worker_id: 'worker-1',
        worker_name: 'Baileys',
        worker_type_id: EWorkerType.baileys,
        chatbot_id: 'chatbot-1',
        chatbot_name: 'Bot',
        type: 'chatbot',
        message: '',
        url: null,
      },
      {
        contact_id: 'contact-1',
        name: 'Contact',
        phone: null,
        phone_ddi: null,
        phone_partial: null,
        is_validated: true,
      },
      '5511999999999@s.whatsapp.net'
    );

    expect(result).toEqual({ success: false, contactId: 'contact-1' });
    expect(chatService.findOpenChatByIdentity).toHaveBeenNthCalledWith(
      1,
      'account-1',
      'worker-1',
      {
        phone: '5511999999999',
        remoteJid: '5511999999999@s.whatsapp.net',
      }
    );
    expect(chatService.findOpenChatByIdentity).toHaveBeenNthCalledWith(
      2,
      'account-1',
      'worker-1',
      {
        phone: '5511999999999',
        remoteJid: '5511999999999@s.whatsapp.net',
      }
    );
    expect(withLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'chat-create:account-1:worker-1:phone%3A5511999999999',
      expect.any(Function),
      { ttlMs: 300000, retryMs: 500 }
    );
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatbotFlowRunnerService.execute).not.toHaveBeenCalled();
    expect(elasticDatabaseService.createDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        status: EScheduleStatus.ignored,
      })
    );
  });
});
