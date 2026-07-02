import 'reflect-metadata';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ChatMessageService } from '@core/services/chatMessage.service';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'message-id'),
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/kafkaBaileysQueue.service', () => ({
  KafkaBaileysQueueService: class KafkaBaileysQueueService {},
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/storage.service', () => ({
  StorageService: class StorageService {},
}));

jest.mock('@core/services/converter', () => ({
  ConverterService: class ConverterService {},
}));

jest.mock('@core/services/contact.service', () => ({
  ContactService: class ContactService {},
}));

jest.mock('@core/repositories/contact/ContactViewer.repository', () => ({
  ContactViewerRepository: class ContactViewerRepository {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

function buildService(
  securityKeyConfig: Record<string, boolean>,
  options?: { workerTypeId?: string | null }
) {
  const chatService = {
    saveMessageChat: jest.fn(async () => true),
    findChatByChatId: jest.fn(async () => ({
      account: { id: 'account-1' },
      status: null,
    })),
    updateChatSummaryAtomically: jest.fn(async () => undefined),
  };
  const kafkaBaileysQueueService = {
    workerSendMessage: jest.fn((workerId: string) => `worker.send.${workerId}`),
  };
  const kafkaServiceQueueService = {
    officialWhatsappSendMessage: jest.fn(
      () => 'official.whatsapp.send.message'
    ),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
  };
  const workerService = {
    viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({})),
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: options?.workerTypeId ?? 'non-official-worker-type',
    })),
  };
  const workerConfigService = {
    viewSecurityKey: jest.fn(async () => securityKeyConfig),
  };

  const service = new ChatMessageService(
    {} as never,
    chatService as never,
    {} as never,
    kafkaBaileysQueueService as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    centrifugoService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    workerService as never,
    workerConfigService as never
  );

  return {
    centrifugoService,
    chatService,
    kafkaBaileysQueueService,
    service: service as any,
    streamProducerService,
    workerConfigService,
    workerService,
  };
}

describe('ChatMessageService security key append', () => {
  it('appends one security key when any requested scope is enabled', async () => {
    const { service, workerConfigService } = buildService({
      enabled: true,
      chatbot: false,
      schedule: true,
      quick_message: false,
    });

    const result = await service.appendSecurityKeyIfNeeded(
      { worker: { id: 'worker-1' } },
      'Mensagem agendada',
      ['chatbot', 'schedule']
    );

    expect(result).toMatch(
      /^Mensagem agendada\n\n> ```Chave de segurança: [A-Z0-9]{10}```$/
    );
    expect(workerConfigService.viewSecurityKey).toHaveBeenCalledWith(
      'worker-1'
    );
  });

  it('appends the security key to chatbot text messages sent through sendMessage', async () => {
    const { service, streamProducerService } = buildService({
      enabled: true,
      chatbot: true,
      schedule: false,
      quick_message: false,
    });

    await expect(
      service.sendMessage(((key: string) => key) as never, {
        accountId: 'account-1',
        chat: {
          account: { id: 'account-1' },
          chat_id: 'chat-1',
          message_key: { remote_jid: '5511999999999@c.us' },
          phone: null,
          user: null,
          worker: { id: 'worker-1' },
        },
        message: 'Menu Principal\n\n*1.* Redirecionamento',
        securityKeyScopes: ['chatbot'],
        type: EMessageType.system,
        typeUser: ETypeUserChat.bot,
      })
    ).resolves.toBe(true);

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.send.worker-1',
      expect.objectContaining({
        content: expect.objectContaining({
          message: expect.stringMatching(
            /^Menu Principal\n\n\*1\.\* Redirecionamento\n\n> ```Chave de segurança: [A-Z0-9]{10}```$/
          ),
        }),
      }),
      'chat:account-1:chat-1'
    );
  });

  it('does not append security key to chatbot text messages sent through official channels', async () => {
    const { service, streamProducerService, workerConfigService } =
      buildService(
        {
          enabled: true,
          chatbot: true,
          schedule: false,
          quick_message: false,
        },
        { workerTypeId: EWorkerType.whatsapp }
      );

    await expect(
      service.sendMessage(((key: string) => key) as never, {
        accountId: 'account-1',
        chat: {
          account: { id: 'account-1' },
          chat_id: 'chat-1',
          message_key: { remote_jid: '5511999999999@c.us' },
          phone: null,
          user: null,
          worker: { id: 'worker-1' },
        },
        message: 'Menu Principal',
        securityKeyScopes: ['chatbot'],
        type: EMessageType.system,
        typeUser: ETypeUserChat.bot,
      })
    ).resolves.toBe(true);

    expect(workerConfigService.viewSecurityKey).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.send.message',
      expect.objectContaining({
        content: expect.objectContaining({
          message: 'Menu Principal',
        }),
      }),
      'chat:account-1:chat-1'
    );
  });

  it('does not read security key config when the chat already marks the worker as official', async () => {
    const { service, workerConfigService, workerService } = buildService({
      enabled: true,
      chatbot: true,
      schedule: true,
      quick_message: true,
    });

    await expect(
      service.appendSecurityKeyIfNeeded(
        {
          account: { id: 'account-1' },
          worker: {
            id: 'worker-1',
            type_id: EWorkerType.whatsapp,
            is_official: true,
          },
        },
        'Mensagem',
        ['chatbot']
      )
    ).resolves.toBe('Mensagem');

    expect(workerService.viewWorkerType).not.toHaveBeenCalled();
    expect(workerConfigService.viewSecurityKey).not.toHaveBeenCalled();
  });

  it('does not append for disabled main flag, inactive scopes, or empty text', async () => {
    const { service } = buildService({
      enabled: false,
      chatbot: true,
      schedule: true,
      quick_message: true,
    });

    await expect(
      service.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        'Mensagem',
        ['chatbot']
      )
    ).resolves.toBe('Mensagem');

    const activeService = buildService({
      enabled: true,
      chatbot: false,
      schedule: true,
      quick_message: false,
    }).service;

    await expect(
      activeService.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        'Mensagem',
        ['quick_message']
      )
    ).resolves.toBe('Mensagem');
    await expect(
      activeService.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        '   ',
        ['schedule']
      )
    ).resolves.toBe('   ');
  });

  it('uses the security key as caption for media messages without original caption', async () => {
    const { service } = buildService({
      enabled: true,
      chatbot: true,
      schedule: false,
      quick_message: true,
    });

    await expect(
      service.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        null,
        ['quick_message'],
        { allowSecurityKeyOnly: true }
      )
    ).resolves.toMatch(/^> ```Chave de segurança: [A-Z0-9]{10}```$/);
    await expect(
      service.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        '',
        ['chatbot'],
        { allowSecurityKeyOnly: true }
      )
    ).resolves.toMatch(/^> ```Chave de segurança: [A-Z0-9]{10}```$/);
  });

  it('does not use the security key as media caption for official channels', async () => {
    const { service, workerConfigService } = buildService(
      {
        enabled: true,
        chatbot: true,
        schedule: false,
        quick_message: true,
      },
      { workerTypeId: EWorkerType.whatsapp }
    );

    await expect(
      service.appendSecurityKeyIfNeeded(
        {
          account: { id: 'account-1' },
          worker: { id: 'worker-1' },
        },
        null,
        ['quick_message'],
        { allowSecurityKeyOnly: true }
      )
    ).resolves.toBeNull();
    expect(workerConfigService.viewSecurityKey).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing security key suffix', async () => {
    const { service } = buildService({
      enabled: true,
      chatbot: true,
      schedule: true,
      quick_message: true,
    });
    const message = 'Mensagem\n\n> ```Chave de segurança: ABC123XYZ0```';

    await expect(
      service.appendSecurityKeyIfNeeded(
        { worker: { id: 'worker-1' } },
        message,
        ['chatbot', 'schedule']
      )
    ).resolves.toBe(message);
  });
});
