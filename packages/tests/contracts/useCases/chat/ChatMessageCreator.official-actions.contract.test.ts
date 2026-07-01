import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: jest.fn(() => 'action-message-1') }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';

const chat: IChat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Official' },
  user: { id: 'user-1', name: 'Agent' },
  name: 'Maycon',
  phone: '5511999999999',
  status: EChatStatus.queue,
  date: '2026-06-01T10:00:00.000Z',
};

const targetMessage: IChatMessage = {
  message_id: 'target-message-1',
  chat_id: 'chat-1',
  message_key: {
    id: 'wamid.target',
    remote_jid: '5511999999999@s.whatsapp.net',
    from_me: false,
    is_view_once: false,
  },
  type_user: ETypeUserChat.client,
  account: chat.account,
  worker: chat.worker,
  phone: chat.phone,
  summary: {
    is_sent: true,
    is_delivered: true,
    is_seen: false,
    is_sent_to_internal: true,
  },
  date: '2026-06-01T10:00:00.000Z',
  content: {
    type: EMessageType.text,
    message: 'Oi',
  },
};

function makeUseCase() {
  const kafkaBaileysQueueService = {
    workerSendMessage: jest.fn((workerId: string) => `baileys.${workerId}`),
  };
  const kafkaServiceQueueService = {
    officialWhatsappSendMessage: jest.fn(
      () => 'official.whatsapp.send.message'
    ),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const chatMessageService = {
    sendMessage: jest.fn(async () => true),
  };
  const userService = {
    viewUserNamePhoto: jest.fn(async () => chat.user),
  };
  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: EWorkerType.whatsapp,
    })),
  };

  const useCase = new ChatMessageCreatorUseCase(
    {} as never,
    { saveMessageChat: jest.fn(async () => true) } as never,
    {} as never,
    kafkaBaileysQueueService as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    {} as never,
    {} as never,
    chatMessageService as never,
    userService as never,
    { resetOnOperatorMessage: jest.fn() } as never,
    workerService as never
  );

  (useCase as any).getMessage = jest.fn(async () => targetMessage);
  (useCase as any).updateMessageReaction = jest.fn(
    async (_message: IChatMessage, emoji: string) => ({
      ...targetMessage,
      content: {
        ...targetMessage.content,
        reactions: [{ emoji }],
      },
    })
  );
  (useCase as any).centrifugoChatPublish = jest.fn(async () => true);

  return {
    useCase,
    kafkaBaileysQueueService,
    kafkaServiceQueueService,
    streamProducerService,
    chatMessageService,
  };
}

describe('ChatMessageCreatorUseCase official actions', () => {
  it('publishes reactions from official workers to the official send topic', async () => {
    const {
      useCase,
      kafkaBaileysQueueService,
      kafkaServiceQueueService,
      streamProducerService,
    } = makeUseCase();

    await (useCase as any).processReaction(
      { chat, chatId: chat.chat_id, accountId: chat.account.id },
      targetMessage.message_id,
      '👍',
      {
        t: (key: string) => key,
        hash: 'hash-1',
        typeUser: ETypeUserChat.operator,
        senderUser: chat.user,
      }
    );

    expect(
      kafkaServiceQueueService.officialWhatsappSendMessage
    ).toHaveBeenCalled();
    expect(kafkaBaileysQueueService.workerSendMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.send.message',
      expect.objectContaining({
        message_id: 'action-message-1',
        content: expect.objectContaining({
          type: EMessageType.react,
          message: '👍',
        }),
      }),
      'chat:account-1:chat-1'
    );
  });

  it('blocks delete actions for official workers before local deletion', async () => {
    const { useCase, streamProducerService } = makeUseCase();
    const markMessageAsDeleted = jest.fn();
    (useCase as any).markMessageAsDeleted = markMessageAsDeleted;

    await expect(
      (useCase as any).processDelete(
        chat,
        chat.chat_id,
        chat.account.id,
        targetMessage.message_id,
        {
          t: (key: string) => key,
          hash: 'hash-1',
          typeUser: ETypeUserChat.operator,
          senderUser: chat.user,
        }
      )
    ).rejects.toThrow('whatsapp_official_delete_message_not_supported');

    expect(markMessageAsDeleted).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('blocks official audio view-once before sending or saving the message', async () => {
    const { useCase, streamProducerService, chatMessageService } =
      makeUseCase();
    (useCase as any).getChat = jest.fn(async () => chat);

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id },
        {
          type: EMessageType.audio,
          audio_view_once: 'true',
          hash: 'hash-1',
        },
        ETypeUserChat.operator,
        'user-1',
        [],
        []
      )
    ).rejects.toThrow('whatsapp_official_view_once_not_supported');

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });
});
