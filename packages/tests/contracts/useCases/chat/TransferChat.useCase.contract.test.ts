import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));

jest.mock('@core/services/sector.service', () => ({
  SectorService: class SectorService {},
}));

jest.mock('@core/services/chatMessage.service', () => ({
  ChatMessageService: class ChatMessageService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/chatbot.service', () => ({
  ChatbotService: class ChatbotService {},
}));
jest.mock('@core/services/chatbotFlowRunner.service', () => ({
  ChatbotFlowRunnerService: class ChatbotFlowRunnerService {},
}));

jest.mock('@core/repositories/chat/ChatUserViewer.repository', () => ({
  ChatUserViewerRepository: class ChatUserViewerRepository {},
}));

jest.mock('@core/services/pushNotification.service', () => ({
  PushNotificationService: class PushNotificationService {},
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import type { IChat } from '@core/common/interfaces/IChat';
import { TransferChatUseCase } from '@core/useCases/chat/TransferChat.useCase';

describe('TransferChatUseCase chatbot transfer', () => {
  const t = jest.fn((key: string) => key) as never;

  const makeChat = (): IChat => ({
    chat_id: 'chat-1',
    message_key: {
      remote_jid: '5511999999999@s.whatsapp.net',
      remote_jid_alt: null,
    },
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-1', name: 'Channel' },
    user: { id: 'user-1', name: 'Agent', photo: null },
    secondary_users: [{ id: 'user-3', name: 'Secondary', photo: null }],
    sector: { id: 'sector-1', name: 'Support', color: '#1976D2' },
    contact: null,
    name: 'Contact',
    phone: '5511999999999',
    status: EChatStatus.in_chat,
    date: '2026-06-17T10:00:00.000Z',
    forward_to_output_chatbot: true,
  });

  const makeUseCase = (chat: IChat = makeChat()) => {
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      saveChat: jest.fn(async () => true),
      clearChatSummary: jest.fn(async () => undefined),
      invalidateChatCache: jest.fn(async () => undefined),
      viewWorkerConfigForChat: jest.fn(async () => ({
        input_chatbot: {
          chatbot_id: 'chatbot-input-1',
          name: 'Entrada',
          type: EChatbotType.input,
        },
        output_chatbot: {
          chatbot_id: 'chatbot-output-1',
          name: 'Saida',
          type: EChatbotType.output,
        },
      })),
    };
    const userService = {
      listUserIdsWithAccessToChannel: jest.fn(async () => ['user-2']),
    };
    const sectorService = {
      listSectorUsersForTransfer: jest.fn(async () => []),
    };
    const chatMessageService = {
      sendMessage: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => ({
        id: 'worker-2',
        name: 'Target Channel',
      })),
    };
    const chatbotFlowRunnerService = {
      clearFlowCacheForChat: jest.fn(async () => undefined),
      execute: jest.fn(async () => 'start-node'),
    };
    const chatUserViewerRepository = {
      findStatusByUserId: jest.fn(),
    };
    const redis = {
      del: jest.fn(async () => undefined),
    };
    const pushNotificationService = {
      sendNotificationForChatTransfer: jest.fn(async () => undefined),
    };

    const useCase = new TransferChatUseCase(
      chatService as never,
      userService as never,
      sectorService as never,
      chatMessageService as never,
      centrifugoService as never,
      workerService as never,
      chatbotFlowRunnerService as never,
      chatUserViewerRepository as never,
      redis as never,
      pushNotificationService as never
    );

    return {
      useCase,
      chatService,
      workerService,
      chatbotFlowRunnerService,
      pushNotificationService,
    };
  };

  it('moves the chat to ura and starts the selected input chatbot', async () => {
    const {
      useCase,
      chatService,
      workerService,
      chatbotFlowRunnerService,
      pushNotificationService,
    } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-input-1' },
        'user-1',
        null,
        []
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(workerService.viewWorkerNameAndId).toHaveBeenCalledWith(
      'account-1',
      'worker-2'
    );
    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: { id: 'worker-2', name: 'Target Channel' },
        status: EChatStatus.ura,
        user: null,
        secondary_users: [],
        sector: null,
        forward_to_output_chatbot: false,
        chatbot_transfer_id: 'chatbot-input-1',
        chatbot_schedule_id: null,
        chatbot_webhook_id: null,
      })
    );
    expect(chatbotFlowRunnerService.clearFlowCacheForChat).toHaveBeenCalledWith(
      'account-1',
      'worker-2',
      'chat-1'
    );
    expect(chatbotFlowRunnerService.execute).toHaveBeenCalledWith(
      t,
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-2',
      }),
      expect.objectContaining({
        status: EChatStatus.ura,
        chatbot_transfer_id: 'chatbot-input-1',
      }),
      'chatbot-input-1'
    );
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });

  it('requires a channel when transferring to chatbot', async () => {
    const { useCase, chatService } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { chatbot_id: 'chatbot-input-1' },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('channel_required');

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  it('rejects chatbot transfer combined with user or sector targets', async () => {
    const { useCase, chatService } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        {
          worker_id: 'worker-2',
          chatbot_id: 'chatbot-input-1',
          sector_id: 'sector-2',
        },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('transfer_chatbot_cannot_combine_targets');

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  it('rejects chatbot targets that are not linked to the channel', async () => {
    const { useCase, chatService } = makeUseCase();
    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-other' },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('chatbot_not_found');

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  it('rejects chatbot transfer when the channel has no active linked chatbot', async () => {
    const { useCase, chatService } = makeUseCase();
    chatService.viewWorkerConfigForChat.mockResolvedValueOnce({
      input_chatbot: null,
      output_chatbot: null,
    } as never);

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-input-1' },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('chatbot_not_found');

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  it('moves the chat to ura_output and starts the linked output chatbot', async () => {
    const { useCase, chatService, chatbotFlowRunnerService } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-output-1' },
        'user-1',
        null,
        []
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: { id: 'worker-2', name: 'Target Channel' },
        status: EChatStatus.ura_output,
        user: null,
        secondary_users: [],
        sector: null,
        forward_to_output_chatbot: false,
        chatbot_transfer_id: null,
        chatbot_schedule_id: null,
        chatbot_webhook_id: null,
      })
    );
    expect(chatbotFlowRunnerService.execute).toHaveBeenCalledWith(
      t,
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-2',
      }),
      expect.objectContaining({
        status: EChatStatus.ura_output,
        chatbot_transfer_id: null,
      }),
      'chatbot-output-1'
    );
  });
});
