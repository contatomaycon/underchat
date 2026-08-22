import 'reflect-metadata';

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  chatAccountCentrifugo: jest.fn((accountId: string) => `chat:${accountId}`),
  chatQueueAccountCentrifugo: jest.fn(
    (accountId: string) => `chat.queue:${accountId}`
  ),
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
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

jest.mock('@core/services/workerCommandAdmission.service', () => ({
  WorkerCommandAdmissionService: class WorkerCommandAdmissionService {},
}));

import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { runWithKafkaDispatchGuard } from '@core/common/functions/kafkaDispatchFenceContext';

describe('ChatMessageService', () => {
  const makeService = (saveMessageChatResult: boolean) => {
    const currentChat = {
      account: { id: 'acc-1' },
      chat_id: 'chat-1',
      status: EChatStatus.ura,
    };
    const chatService = {
      saveMessageChat: jest.fn().mockResolvedValue(saveMessageChatResult),
      markWorkerCommandAccepted: jest.fn().mockResolvedValue(undefined),
      updateChatSummaryAtomically: jest.fn().mockResolvedValue(undefined),
      findChatByChatId: jest.fn().mockResolvedValue(currentChat),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn().mockResolvedValue({
        receipt: {
          command_id: 'command-1',
          operation_id: 'message-1',
          stream: 'UC_WORKER_COMMANDS_V1',
          stream_sequence: 1,
          duplicate: false,
          accepted_at: '2026-05-07T12:00:00.100Z',
          expires_at: '2026-05-07T12:05:00.000Z',
        },
      }),
    };
    const kafkaServiceQueueService = {
      officialWhatsappSendMessage: jest
        .fn()
        .mockReturnValue('official.whatsapp.send.message'),
    };
    const streamProducerService = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn().mockResolvedValue(undefined),
    };
    const storageService = {
      uploadAudioFromBuffer: jest.fn(),
    };
    const converterService = {
      convertAudio: jest.fn(),
      generateWaveformWithFfmpeg: jest.fn(),
    };
    const contactService = {
      getContactSensitiveDataDecrypted: jest.fn(async (contactId: string) => ({
        phone: `551199999${contactId.slice(-1)}`,
        email: `${contactId}@example.com`,
      })),
    };
    const contactViewerRepository = {
      viewContactById: jest.fn(async (contactId: string) => ({
        contact_id: contactId,
        name: `Contact ${contactId}`,
        last_name: null,
        phone_partial: '9999',
        phone_ddi: '55',
        email_partial: null,
        photo: null,
      })),
    };
    const workerService = {
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({})),
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: 'non-official-worker-type',
      })),
    };
    const service = new ChatMessageService(
      {} as never,
      chatService as never,
      {} as never,
      workerCommandAdmissionService as never,
      kafkaServiceQueueService as never,
      streamProducerService as never,
      centrifugoService as never,
      storageService as never,
      converterService as never,
      contactService as never,
      contactViewerRepository as never,
      workerService as never,
      {} as never
    );

    return {
      chatService,
      contactService,
      contactViewerRepository,
      converterService,
      centrifugoService,
      service,
      storageService,
      streamProducerService,
      workerCommandAdmissionService,
    };
  };

  const chat = {
    account: { id: 'acc-1' },
    chat_id: 'chat-1',
    message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    name: 'Contact',
    phone: '5511999999999',
    status: EChatStatus.ura,
    date: '2026-07-09T12:00:00.000Z',
    user: null,
    worker: { id: 'worker-1' },
  };

  const translate = ((key: string) => key) as never;

  const message = {
    account: { id: 'acc-1' },
    chat_id: 'chat-1',
    message_id: 'message-1',
    worker: { id: 'worker-1' },
  } as IChatMessage;

  it('does not publish to the worker when Elasticsearch persistence fails', async () => {
    const { service, streamProducerService, workerCommandAdmissionService } =
      makeService(false);

    await expect(service.publishPreparedMessage({ ...message })).resolves.toBe(
      false
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).not.toHaveBeenCalled();
  });

  it('publishes to the worker only after Elasticsearch persistence succeeds', async () => {
    const {
      chatService,
      service,
      streamProducerService,
      workerCommandAdmissionService,
    } = makeService(true);

    await expect(service.publishPreparedMessage({ ...message })).resolves.toBe(
      true
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        workerId: 'worker-1',
        commandType: 'direct_send',
        entityKey: 'chat:acc-1:worker-1:chat-1',
        operationId: 'message-1',
        payload: expect.objectContaining({
          message_id: 'message-1',
          sent_from_platform: true,
        }),
        source: 'chat_message',
        retry: false,
        issuedAt: expect.any(String),
      })
    );
    expect(chatService.saveMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'message-1',
        sent_from_platform: true,
      }),
      expect.objectContaining({
        eventTypes: ['message.sent', 'message.delivery.queued'],
        idempotencyKey: 'message-created:message-1',
        source: 'underchat',
        changes: expect.objectContaining({ delivery_status: 'queued' }),
      })
    );
    expect(
      chatService.saveMessageChat.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workerCommandAdmissionService.admit.mock.invocationCallOrder[0]
    );
    expect(chatService.markWorkerCommandAccepted).toHaveBeenCalledWith(
      'acc-1',
      'message-1',
      expect.objectContaining({
        command_id: 'command-1',
        stream: 'UC_WORKER_COMMANDS_V1',
        stream_sequence: 1,
      })
    );
  });

  it('requires a JetStream PubAck and never falls back to Kafka', async () => {
    const {
      chatService,
      service,
      streamProducerService,
      workerCommandAdmissionService,
    } = makeService(true);
    workerCommandAdmissionService.admit.mockRejectedValueOnce(
      new Error('worker_command_puback_unknown')
    );

    await expect(
      service.publishPreparedMessage({ ...message })
    ).rejects.toThrow('worker_command_puback_unknown');

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledTimes(1);
    expect(chatService.markWorkerCommandAccepted).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('retries an existing message through the same operation identity', async () => {
    const { service, workerCommandAdmissionService } = makeService(true);

    await expect(
      service.publishPreparedMessage(
        { ...message },
        'public_api',
        undefined,
        true
      )
    ).resolves.toBe(true);

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'message-1',
        retry: true,
        source: 'public_api',
      })
    );
  });

  it('reports acceptance when queueing succeeded but chat rehydration is unavailable', async () => {
    const { chatService, service, workerCommandAdmissionService } =
      makeService(true);
    chatService.findChatByChatId.mockResolvedValue(null);

    await expect(service.publishPreparedMessage({ ...message })).resolves.toBe(
      true
    );

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledTimes(1);
  });

  it('does not report a queue failure when post-queue summary projection fails', async () => {
    const { chatService, service, workerCommandAdmissionService } =
      makeService(true);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    chatService.updateChatSummaryAtomically.mockRejectedValueOnce(
      new Error('projection unavailable')
    );

    try {
      await expect(
        service.publishPreparedMessage({
          ...message,
          date: '2026-07-21T10:00:00.000Z',
          type_user: ETypeUserChat.operator,
          content: { type: EMessageType.text, message: 'Mensagem' },
        })
      ).resolves.toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledTimes(1);
  });

  it('does not persist or publish when the assignment is already revoked', async () => {
    const { chatService, centrifugoService, service, streamProducerService } =
      makeService(true);
    const assertActive = jest.fn(() => {
      throw new Error('Kafka consumer assignment was revoked');
    });

    await expect(
      service.publishPreparedMessage({ ...message }, undefined, assertActive)
    ).rejects.toThrow('Kafka consumer assignment was revoked');

    expect(chatService.saveMessageChat).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('uses the dispatch context to stop Kafka and Centrifugo after delayed persistence', async () => {
    const { chatService, centrifugoService, service, streamProducerService } =
      makeService(true);
    let assignmentActive = true;
    const assertActive = jest.fn(() => {
      if (!assignmentActive) {
        throw new Error('Kafka consumer assignment was revoked');
      }
    });
    chatService.saveMessageChat.mockImplementationOnce(async () => {
      await Promise.resolve();
      assignmentActive = false;
      return true;
    });

    await expect(
      runWithKafkaDispatchGuard(assertActive, () =>
        service.publishPreparedMessage({ ...message })
      )
    ).rejects.toThrow('Kafka consumer assignment was revoked');

    expect(chatService.saveMessageChat).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('attributes API-published messages to the originating route module', async () => {
    const { chatService, service } = makeService(true);

    await expect(
      service.publishPreparedMessage({ ...message }, 'public_api')
    ).resolves.toBe(true);

    expect(chatService.saveMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'message-1' }),
      expect.objectContaining({
        source: 'public_api',
        changes: expect.objectContaining({ origin: 'public_api' }),
      })
    );
  });

  it('does not clear pending operator reply when operator sends annotation in in_chat', async () => {
    const { chatService, service } = makeService(true);
    chatService.findChatByChatId
      .mockResolvedValueOnce({ status: EChatStatus.in_chat })
      .mockResolvedValueOnce({ account: { id: 'acc-1' } });

    const annotationMessage = {
      ...message,
      date: '2026-05-07T12:00:00.000Z',
      type_user: ETypeUserChat.operator,
      content: {
        type: EMessageType.annotation,
        message: 'Nota interna',
      },
    } as IChatMessage;

    await expect(
      service.publishPreparedMessage(annotationMessage)
    ).resolves.toBe(true);

    expect(chatService.saveMessageChat).toHaveBeenCalledWith(
      annotationMessage,
      expect.objectContaining({
        eventTypes: ['message.annotation.created'],
        idempotencyKey: `message-created:${annotationMessage.message_id}`,
        changes: { direction: 'internal' },
      })
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      annotationMessage.chat_id,
      expect.anything(),
      annotationMessage.date,
      expect.any(Number),
      annotationMessage.message_id,
      annotationMessage.message_id,
      false,
      ETypeUserChat.operator,
      false,
      false
    );
  });

  it('clears unread in the same summary mutation as an operator message', async () => {
    const { chatService, service } = makeService(true);
    chatService.findChatByChatId
      .mockResolvedValueOnce({
        account: { id: 'acc-1' },
        chat_id: 'chat-1',
        status: EChatStatus.in_chat,
        summary: { revision: 7, unread_count: 3 },
      })
      .mockResolvedValueOnce({
        account: { id: 'acc-1' },
        chat_id: 'chat-1',
        status: EChatStatus.in_chat,
        summary: { revision: 8, unread_count: 0 },
      });

    const operatorMessage = {
      ...message,
      date: '2026-05-07T12:00:00.000Z',
      type_user: ETypeUserChat.operator,
      content: {
        type: EMessageType.text,
        message: 'Resposta do operador',
      },
    } as IChatMessage;

    await expect(service.publishPreparedMessage(operatorMessage)).resolves.toBe(
      true
    );

    expect(chatService.updateChatSummaryAtomically).toHaveBeenCalledWith(
      operatorMessage.chat_id,
      'Resposta do operador',
      operatorMessage.date,
      expect.any(Number),
      operatorMessage.message_id,
      operatorMessage.message_id,
      false,
      ETypeUserChat.operator,
      true,
      true
    );
  });

  it('journals a queued delivery event for outbound system messages', async () => {
    const { chatService, service } = makeService(true);
    const systemMessage = {
      ...message,
      date: '2026-05-07T12:00:00.000Z',
      type_user: ETypeUserChat.system,
      content: {
        type: EMessageType.system,
        message: 'Transferência concluída',
      },
    } as IChatMessage;

    await expect(service.publishPreparedMessage(systemMessage)).resolves.toBe(
      true
    );

    expect(chatService.saveMessageChat).toHaveBeenCalledWith(
      systemMessage,
      expect.objectContaining({
        eventTypes: ['message.system.created', 'message.delivery.queued'],
        idempotencyKey: `message-created:${systemMessage.message_id}`,
        changes: {
          direction: 'outbound',
          delivery_status: 'queued',
        },
      })
    );
  });

  it('propagates audio conversion failures instead of silently dropping upload', async () => {
    const { converterService, service, storageService } = makeService(true);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const audioUpload = {
      filename: 'voice.m4a',
      mimetype: 'audio/mp4',
      encoding: '7bit',
      file: {},
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('original-audio')),
    };

    converterService.convertAudio.mockRejectedValue(
      new Error('Arquivo de áudio convertido fora do perfil de voz WhatsApp.')
    );

    try {
      await expect(
        (service as any).uploadAudios([audioUpload], 'acc-1', true)
      ).rejects.toThrow(
        'Falha ao converter áudio para um formato compatível: Arquivo de áudio convertido fora do perfil de voz WhatsApp.'
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(storageService.uploadAudioFromBuffer).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'image',
      options: {
        type: EMessageType.image,
        imageUrl: 'https://example.com/image.png',
        imageMimetype: 'image/png',
      },
    },
    {
      name: 'video',
      options: {
        type: EMessageType.video,
        videoUrl: 'https://example.com/video.mp4',
        videoMimetype: 'video/mp4',
      },
    },
    {
      name: 'audio',
      options: {
        type: EMessageType.audio,
        audioUrl: 'https://example.com/audio.ogg',
        audioMimetype: 'audio/ogg',
        audioPtt: true,
      },
    },
    {
      name: 'document',
      options: {
        type: EMessageType.document,
        documentUrl: 'https://example.com/document.pdf',
        documentMimetype: 'application/pdf',
      },
    },
    {
      name: 'location',
      options: {
        type: EMessageType.location,
        latitude: -23.5505,
        longitude: -46.6333,
      },
    },
    {
      name: 'official interactive',
      options: {
        type: EMessageType.official_interactive,
        officialInteractive: {
          type: 'button',
          interactive: {
            body: { text: 'Choose an option' },
            action: { buttons: [] },
          },
          summary: 'Choose an option',
        },
      },
    },
  ])('uses the provided message id for $name messages', async ({ options }) => {
    const { chatService, service } = makeService(true);

    await expect(
      service.sendMessage(translate, {
        ...options,
        accountId: 'acc-1',
        chat,
        message: 'Deterministic message',
        messageId: 'stable-message-id',
        typeUser: ETypeUserChat.bot,
      } as never)
    ).resolves.toBe(true);

    expect(chatService.saveMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'stable-message-id',
        hash: expect.any(String),
      }),
      expect.objectContaining({
        eventTypes: expect.arrayContaining(['message.sent']),
        idempotencyKey: 'message-created:stable-message-id',
        source: 'underchat',
      })
    );
  });

  it('rejects an oversized official interactive before persistence or queueing', async () => {
    const { chatService, service, streamProducerService } = makeService(true);

    await expect(
      service.sendMessage(translate, {
        accountId: 'acc-1',
        chat,
        message: 'Oversized interactive',
        type: EMessageType.official_interactive,
        typeUser: ETypeUserChat.bot,
        officialInteractive: {
          type: 'button',
          interactive: {
            type: 'button',
            body: { text: 'B'.repeat(1025) },
            action: { buttons: [] },
          },
        },
      } as never)
    ).rejects.toThrow('official_whatsapp_interactive_limit_exceeded');

    expect(chatService.saveMessageChat).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('derives distinct and stable ids for each contact subitem', async () => {
    const { chatService, service } = makeService(true);
    const options = {
      accountId: 'acc-1',
      chat,
      contactIds: ['contact-1', 'contact-2'],
      hash: 'stable-contact-hash',
      message: 'Contacts',
      messageId: 'stable-contact-operation',
      type: EMessageType.contact_card,
      typeUser: ETypeUserChat.bot,
    };

    await expect(
      service.sendMessage(translate, options as never)
    ).resolves.toBe(true);
    const firstAttempt = chatService.saveMessageChat.mock.calls.map(
      ([savedMessage]) => ({
        hash: savedMessage.hash,
        messageId: savedMessage.message_id,
      })
    );

    chatService.saveMessageChat.mockClear();
    await expect(
      service.sendMessage(translate, options as never)
    ).resolves.toBe(true);
    const secondAttempt = chatService.saveMessageChat.mock.calls.map(
      ([savedMessage]) => ({
        hash: savedMessage.hash,
        messageId: savedMessage.message_id,
      })
    );

    expect(firstAttempt).toHaveLength(2);
    expect(new Set(firstAttempt.map(({ messageId }) => messageId)).size).toBe(
      2
    );
    expect(new Set(firstAttempt.map(({ hash }) => hash)).size).toBe(2);
    expect(secondAttempt).toEqual(firstAttempt);
  });
});
