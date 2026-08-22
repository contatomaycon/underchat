import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

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
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import type { IChat } from '@core/common/interfaces/IChat';
import { TransferChatUseCase } from '@core/useCases/chat/TransferChat.useCase';

describe('TransferChatUseCase chatbot transfer', () => {
  const t = jest.fn((key: string) => key) as never;

  const makeChat = (overrides: Partial<IChat> = {}): IChat =>
    ({
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
      ...overrides,
    }) as IChat;

  const makeUseCase = (chat: IChat = makeChat()) => {
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      findOpenChatByIdentity: jest.fn(async () => null as IChat | null),
      saveChat: jest.fn(async () => true),
      transferAutomationChatToQueue: jest.fn(
        async (input: {
          worker?: IChat['worker'] | null;
          user?: IChat['user'] | null;
          sector?: IChat['sector'] | null;
          secondaryUsers?: IChat['secondary_users'] | null;
        }) => ({
          chat: {
            ...chat,
            worker: input.worker ?? chat.worker,
            user: input.user ?? null,
            sector: input.sector ?? null,
            secondary_users: input.secondaryUsers ?? [],
            status: EChatStatus.queue,
            forward_to_output_chatbot: true,
            chatbot_transfer_id: null,
            chatbot_schedule_id: null,
            chatbot_webhook_id: null,
          },
          previousChat: chat,
          applied: true,
          alreadyHuman: true,
        })
      ),
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
      viewUserNamePhoto: jest.fn(async (userId: string) => ({
        id: userId,
        name: userId === 'user-2' ? 'Gisele' : 'Agent',
        photo: null,
      })),
    };
    const sectorService = {
      listSectorUsersForTransfer: jest.fn(async () => []),
      viewSectorById: jest.fn(
        async (): Promise<{
          sector_id: string;
          name: string;
          color: string;
        } | null> => null
      ),
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
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => null),
    };
    const chatbotFlowRunnerService = {
      clearFlowCacheForChat: jest.fn(async () => undefined),
      execute: jest.fn(async () => 'start-node'),
    };
    const chatUserViewerRepository = {
      findStatusByUserId: jest.fn(),
    };
    const redis = {
      status: 'ready',
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
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
      sectorService,
      workerService,
      chatbotFlowRunnerService,
      pushNotificationService,
      redis,
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
      }),
      expect.objectContaining({
        allowHumanToAutomation: true,
        refresh: true,
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

  it('rejects a target channel outside the direct channel scope without the permission', async () => {
    const { useCase, chatService } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-input-1' },
        'user-1',
        null,
        [],
        [{ id: 'worker-1', name: 'Channel' }]
      )
    ).rejects.toThrow('chat_access_denied');

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  it('allows a target channel outside the direct channel scope with the permission', async () => {
    const { useCase, chatService } = makeUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', chatbot_id: 'chatbot-input-1' },
        'user-1',
        null,
        [
          {
            action_name:
              EWorkerPermissions.view_all_channels_for_transfer_and_forwarding,
          },
        ] as never,
        [{ id: 'worker-1', name: 'Channel' }]
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(chatService.saveChat).toHaveBeenCalled();
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

  it('rejects a cross-channel transfer when the contact already has an open target chat', async () => {
    const { useCase, chatService, redis } = makeUseCase();
    chatService.findOpenChatByIdentity.mockResolvedValueOnce(
      makeChat({
        chat_id: 'chat-2',
        worker: { id: 'worker-2', name: 'Target Channel' },
        user: { id: 'user-2', name: 'Gisele', photo: null },
      })
    );

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', user_id: 'user-2' },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('chat_already_in_service');

    expect(chatService.findOpenChatByIdentity).toHaveBeenCalledWith(
      'account-1',
      'worker-2',
      {
        phone: '5511999999999',
        remoteJid: '5511999999999@s.whatsapp.net',
        remoteJidAlt: null,
      }
    );
    expect(redis.set).toHaveBeenCalledWith(
      'underchat:lock:chat-create:account-1:worker-2:phone%3A5511999999999',
      expect.any(String),
      'PX',
      60_000,
      'NX'
    );
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.transferAutomationChatToQueue).not.toHaveBeenCalled();
  });

  it('does not treat the transferred chat itself as a target-channel collision', async () => {
    const { useCase, chatService } = makeUseCase();
    chatService.findOpenChatByIdentity.mockResolvedValueOnce(
      makeChat({
        worker: { id: 'worker-2', name: 'Target Channel' },
      })
    );

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { worker_id: 'worker-2', user_id: 'user-2' },
        'user-1',
        null,
        []
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(chatService.saveChat).toHaveBeenCalled();
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
      }),
      expect.objectContaining({
        allowHumanToAutomation: true,
        refresh: true,
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

  it('uses atomic handoff instead of saveChat when transferring chatbot chat to a user', async () => {
    const chatbotChat = makeChat({
      status: EChatStatus.ura,
      chatbot_transfer_id: 'chatbot-input-1',
      chatbot_schedule_id: 'schedule-1',
      chatbot_webhook_id: 'webhook-1',
      forward_to_output_chatbot: false,
    });
    const { useCase, chatService, chatbotFlowRunnerService } =
      makeUseCase(chatbotChat);

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { user_id: 'user-2' },
        'user-1',
        null,
        []
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(chatService.transferAutomationChatToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        chat: chatbotChat,
        worker: chatbotChat.worker,
        user: expect.objectContaining({
          id: 'user-2',
          name: 'Gisele',
        }),
        sector: null,
        secondaryUsers: [],
      })
    );
    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatbotFlowRunnerService.clearFlowCacheForChat).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      'chat-1'
    );
  });

  it('does not report a chatbot handoff as successful when persistence was not applied', async () => {
    const chatbotChat = makeChat({ status: EChatStatus.ura });
    const { useCase, chatService, chatbotFlowRunnerService } =
      makeUseCase(chatbotChat);
    chatService.transferAutomationChatToQueue.mockResolvedValueOnce({
      chat: {
        ...chatbotChat,
        worker: chatbotChat.worker,
        user: null,
        sector: null,
        secondary_users: [],
        status: EChatStatus.ura,
        forward_to_output_chatbot: true,
        chatbot_transfer_id: null,
        chatbot_schedule_id: null,
        chatbot_webhook_id: null,
      },
      previousChat: chatbotChat,
      applied: false,
      alreadyHuman: false,
    });

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { user_id: 'user-2' },
        'user-1',
        null,
        []
      )
    ).rejects.toThrow('chat_transfer_failed');

    expect(
      chatbotFlowRunnerService.clearFlowCacheForChat
    ).not.toHaveBeenCalled();
  });

  it('uses one revision-scoped webhook key for concurrent human transfer retries', async () => {
    const chat = makeChat({
      meta: {
        assignment_event_id: 'assignment-revision-7',
        outbound_webhook_event_ids: ['older-webhook-marker'],
      },
    });
    const { useCase, chatService, sectorService } = makeUseCase(chat);
    sectorService.viewSectorById.mockResolvedValueOnce({
      sector_id: 'sector-2',
      name: 'Billing',
      color: '#123456',
    });

    await useCase.execute(
      t,
      'account-1',
      { chat_id: 'chat-1' },
      { sector_id: 'sector-2' },
      'user-1',
      null,
      []
    );

    expect(chatService.saveChat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        outboundWebhook: expect.objectContaining({
          idempotencyKey:
            'chat-transfer:chat-1:human:assignment-revision-7:worker-1:unassigned:sector-2:replace',
        }),
      })
    );
  });

  it('acknowledges an already-applied human transfer without repeating side effects', async () => {
    const transferredChat = makeChat({
      status: EChatStatus.queue,
      user: null,
      secondary_users: [{ id: 'user-3', name: 'Secondary', photo: null }],
      sector: { id: 'sector-2', name: 'Billing', color: '#123456' },
      chatbot_transfer_id: null,
      chatbot_schedule_id: null,
      chatbot_webhook_id: null,
    });
    const {
      useCase,
      chatService,
      sectorService,
      chatbotFlowRunnerService,
      pushNotificationService,
    } = makeUseCase(transferredChat);
    sectorService.viewSectorById.mockResolvedValueOnce({
      sector_id: 'sector-2',
      name: 'Billing',
      color: '#123456',
    });

    await expect(
      useCase.execute(
        t,
        'account-1',
        { chat_id: 'chat-1' },
        { sector_id: 'sector-2' },
        'user-1',
        EPermissionRole.administrator,
        []
      )
    ).resolves.toEqual({ chat_id: 'chat-1', status: true });

    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
    expect(
      chatbotFlowRunnerService.clearFlowCacheForChat
    ).not.toHaveBeenCalled();
    expect(
      pushNotificationService.sendNotificationForChatTransfer
    ).not.toHaveBeenCalled();
  });
});
