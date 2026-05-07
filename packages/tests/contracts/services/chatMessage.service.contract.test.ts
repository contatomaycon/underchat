import 'reflect-metadata';

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

import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ChatMessageService } from '@core/services/chatMessage.service';

describe('ChatMessageService', () => {
  const makeService = (saveMessageChatResult: boolean) => {
    const chatService = {
      saveMessageChat: jest.fn().mockResolvedValue(saveMessageChatResult),
      updateChatSummaryAtomically: jest.fn().mockResolvedValue(undefined),
      findChatByChatId: jest.fn(),
    };
    const kafkaBaileysQueueService = {
      workerSendMessage: jest.fn().mockReturnValue('worker.send.worker-1'),
    };
    const streamProducerService = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ChatMessageService(
      {} as never,
      chatService as never,
      {} as never,
      kafkaBaileysQueueService as never,
      streamProducerService as never,
      centrifugoService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    return {
      chatService,
      kafkaBaileysQueueService,
      service,
      streamProducerService,
    };
  };

  const message = {
    account: { id: 'acc-1' },
    chat_id: 'chat-1',
    message_id: 'message-1',
    worker: { id: 'worker-1' },
  } as IChatMessage;

  it('does not publish to the worker when Elasticsearch persistence fails', async () => {
    const { service, streamProducerService } = makeService(false);

    await expect(service.publishPreparedMessage({ ...message })).resolves.toBe(
      false
    );

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('publishes to the worker only after Elasticsearch persistence succeeds', async () => {
    const { chatService, service, streamProducerService } = makeService(true);

    await expect(service.publishPreparedMessage({ ...message })).resolves.toBe(
      true
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.send.worker-1',
      expect.objectContaining({ message_id: 'message-1' }),
      'chat-1'
    );
    expect(
      chatService.saveMessageChat.mock.invocationCallOrder[0]
    ).toBeLessThan(streamProducerService.send.mock.invocationCallOrder[0]);
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

    await expect(service.publishPreparedMessage(annotationMessage)).resolves.toBe(
      true
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
      false
    );
  });
});
