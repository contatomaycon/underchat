import 'reflect-metadata';
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

function makeUseCase(options?: {
  workerTypeId?: EWorkerType;
  officialWindowService?: {
    assertCanSendFreeform: jest.Mock<Promise<void>, any[]>;
  };
}) {
  const workerCommandAdmissionService = {
    admit: jest.fn(async () => ({
      receipt: { stream_sequence: 1, duplicate: false },
    })),
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
    publishPreparedMessage: jest.fn(async () => true),
  };
  const chatService = {
    saveMessageChat: jest.fn(async () => true),
    clearChatSummary: jest.fn(async () => undefined),
    findMessageByMessageId: jest.fn(async () => null as IChatMessage | null),
  };
  const userService = {
    viewUserNamePhoto: jest.fn(async () => chat.user),
  };
  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: options?.workerTypeId ?? EWorkerType.whatsapp,
    })),
  };
  const officialWindowService = options?.officialWindowService ?? {
    assertCanSendFreeform: jest.fn(async () => undefined),
  };

  const useCase = new ChatMessageCreatorUseCase(
    {} as never,
    chatService as never,
    {} as never,
    workerCommandAdmissionService as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    {} as never,
    {} as never,
    chatMessageService as never,
    userService as never,
    { resetOnOperatorMessage: jest.fn() } as never,
    workerService as never,
    officialWindowService as never
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
    workerCommandAdmissionService,
    kafkaServiceQueueService,
    streamProducerService,
    chatService,
    chatMessageService,
    officialWindowService,
  };
}

describe('ChatMessageCreatorUseCase official actions', () => {
  it('publishes reactions from official workers to the official send topic', async () => {
    const {
      useCase,
      workerCommandAdmissionService,
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
        messageId: 'action-operation-1',
        typeUser: ETypeUserChat.operator,
        senderUser: chat.user,
      }
    );
    expect(
      kafkaServiceQueueService.officialWhatsappSendMessage
    ).toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.send.message',
      expect.objectContaining({
        message_id: 'action-operation-1',
        content: expect.objectContaining({
          type: EMessageType.react,
          message: '👍',
        }),
      }),
      'chat:account-1:chat-1'
    );
  });

  it('publishes non-official reactions through admission without Kafka fallback', async () => {
    const { useCase, workerCommandAdmissionService, streamProducerService } =
      makeUseCase({ workerTypeId: EWorkerType.baileys });
    const nonOfficialChat: IChat = {
      ...chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    };

    await (useCase as any).processReaction(
      {
        chat: nonOfficialChat,
        chatId: nonOfficialChat.chat_id,
        accountId: nonOfficialChat.account.id,
      },
      targetMessage.message_id,
      '👍',
      {
        t: (key: string) => key,
        hash: 'hash-1',
        messageId: 'action-operation-1',
        typeUser: ETypeUserChat.operator,
        senderUser: nonOfficialChat.user,
      }
    );
    await (useCase as any).processReaction(
      {
        chat: nonOfficialChat,
        chatId: nonOfficialChat.chat_id,
        accountId: nonOfficialChat.account.id,
      },
      targetMessage.message_id,
      '👍',
      {
        t: (key: string) => key,
        hash: 'hash-1',
        messageId: 'action-operation-1',
        typeUser: ETypeUserChat.operator,
        senderUser: nonOfficialChat.user,
      }
    );

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'direct_send',
        entityKey: 'chat:account-1:worker-1:5511999999999@s.whatsapp.net',
        operationId: 'action-operation-1',
        retryOf: null,
        source: 'chat_message_action',
      })
    );
    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).toHaveBeenCalledTimes(2);
    const admissionCalls = workerCommandAdmissionService.admit.mock
      .calls as unknown as [{ payload: unknown }][];
    expect(admissionCalls[1]?.[0].payload).toEqual(
      admissionCalls[0]?.[0].payload
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
          messageId: 'action-operation-1',
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

  it('blocks freeform official messages when the official window service denies them', async () => {
    const officialWindowService = {
      assertCanSendFreeform: jest.fn(async () => {
        throw new Error('whatsapp_official_customer_service_window_closed');
      }),
    };
    const { useCase, chatMessageService, streamProducerService } = makeUseCase({
      officialWindowService,
    });
    (useCase as any).getChat = jest.fn(async () => ({
      ...chat,
      status: EChatStatus.in_chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.whatsapp,
        is_official: true,
      },
    }));

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id },
        {
          type: EMessageType.text,
          message: 'Oi',
          hash: 'hash-1',
        },
        ETypeUserChat.operator,
        'user-1',
        [],
        []
      )
    ).rejects.toThrow('whatsapp_official_customer_service_window_closed');

    expect(officialWindowService.assertCanSendFreeform).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        worker: expect.objectContaining({
          type_id: EWorkerType.whatsapp,
          is_official: true,
        }),
      }),
      EMessageType.text
    );
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('keeps non-official channels on the current freeform flow', async () => {
    const officialWindowService = {
      assertCanSendFreeform: jest.fn(async () => undefined),
    };
    const { useCase, chatMessageService } = makeUseCase({
      workerTypeId: EWorkerType.baileys,
      officialWindowService,
    });
    (useCase as any).getChat = jest.fn(async () => ({
      ...chat,
      status: EChatStatus.in_chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    }));

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id },
        {
          type: EMessageType.text,
          message: 'Oi',
          hash: 'hash-1',
        },
        ETypeUserChat.operator,
        'user-1',
        [],
        []
      )
    ).resolves.toBe(true);

    expect(officialWindowService.assertCanSendFreeform).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        worker: expect.objectContaining({ type_id: EWorkerType.baileys }),
      }),
      EMessageType.text
    );
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ outboundWebhookSource: 'manager_api' })
    );
  });

  it('generates and persists a UUIDv7 operation when HTTP identity is absent', async () => {
    const { useCase, chatMessageService } = makeUseCase({
      workerTypeId: EWorkerType.baileys,
    });
    (useCase as any).getChat = jest.fn(async () => ({
      ...chat,
      status: EChatStatus.in_chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    }));

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id },
        { type: EMessageType.text, message: 'Sem ID legado' },
        ETypeUserChat.operator,
        'user-1',
        [],
        []
      )
    ).resolves.toBe(true);

    const sendMessageCalls = chatMessageService.sendMessage.mock
      .calls as unknown as Array<[unknown, { messageId: string }]>;
    const sendInput = sendMessageCalls[0]?.[1];
    expect(sendInput).toBeDefined();
    expect(sendInput?.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it('retries an existing non-official message with its original operation', async () => {
    const { useCase, chatService, chatMessageService } = makeUseCase({
      workerTypeId: EWorkerType.baileys,
    });
    const nonOfficialChat: IChat = {
      ...chat,
      status: EChatStatus.in_chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    };
    const existingMessage: IChatMessage = {
      ...targetMessage,
      message_id: 'stable-message-operation',
      hash: 'client-retry-hash',
      account: nonOfficialChat.account,
      worker: nonOfficialChat.worker,
      type_user: ETypeUserChat.operator,
      message_key: undefined,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
    };
    chatService.findMessageByMessageId.mockResolvedValue(existingMessage);
    (useCase as any).getChat = jest.fn(async () => nonOfficialChat);

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        nonOfficialChat.account.id,
        { chat_id: nonOfficialChat.chat_id },
        {
          type: EMessageType.text,
          message: 'Retry',
          hash: 'client-retry-hash',
        },
        ETypeUserChat.operator,
        'user-1',
        [],
        [],
        [],
        'public_api'
      )
    ).resolves.toBe(true);

    expect(chatMessageService.publishPreparedMessage).toHaveBeenCalledWith(
      existingMessage,
      'public_api',
      undefined,
      true
    );
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('propagates the public API source into message persistence', async () => {
    const { useCase, chatMessageService } = makeUseCase({
      workerTypeId: EWorkerType.baileys,
    });
    (useCase as any).getChat = jest.fn(async () => ({
      ...chat,
      status: EChatStatus.in_chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    }));

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id },
        {
          type: EMessageType.text,
          message: 'Oi pela API pública',
          hash: 'public-hash-1',
        },
        ETypeUserChat.operator,
        'user-1',
        [],
        [],
        [],
        'public_api'
      )
    ).resolves.toBe(true);

    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ outboundWebhookSource: 'public_api' })
    );
  });
});
