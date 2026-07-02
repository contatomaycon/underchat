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

describe('ScheduleSendService', () => {
  const makeService = () => {
    const contactService = {
      getContactPhoneDecrypted: jest.fn(() => ''),
    };
    const kafkaBaileysQueueService = {
      workerScheduleSendMessage: jest.fn((workerId: string) => {
        return `worker.${workerId}.schedule.send.message`;
      }),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => undefined),
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
      ensureProtocolForNewChat: jest.fn(async (chat) => chat),
      saveChat: jest.fn(async () => true),
    };
    const chatbotFlowRunnerService = {
      execute: jest.fn(async () => undefined),
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

    const service = new ScheduleSendService(
      {} as never,
      {} as never,
      {} as never,
      contactService as never,
      kafkaBaileysQueueService as never,
      streamProducerService as never,
      elasticDatabaseService as never,
      planAccountService as never,
      chatService as never,
      chatbotFlowRunnerService as never,
      encryptService as never,
      {} as never,
      {} as never,
      workerConfigService as never,
      redis as never
    );

    return {
      service,
      contactService,
      kafkaBaileysQueueService,
      streamProducerService,
      elasticDatabaseService,
      planAccountService,
      chatService,
      chatbotFlowRunnerService,
      encryptService,
      workerConfigService,
      redis,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateProtocol.mockReturnValue('PROTO-1');
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

  it('publishes schedule messages keyed by account and channel', async () => {
    const { service, streamProducerService } = makeService();

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
      }
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.worker-1.schedule.send.message',
      expect.objectContaining({
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
      }),
      'account:account-1:channel:worker-1'
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
