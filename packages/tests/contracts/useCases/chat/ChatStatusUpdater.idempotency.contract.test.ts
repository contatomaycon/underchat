import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
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
jest.mock('@core/services/chatMessage.service', () => ({
  ChatMessageService: class ChatMessageService {},
}));
jest.mock('@core/services/presence.service', () => ({
  PresenceService: class PresenceService {},
}));
jest.mock('@core/services/chatbotFlowRunner.service', () => ({
  ChatbotFlowRunnerService: class ChatbotFlowRunnerService {},
}));
jest.mock('@core/services/pushNotification.service', () => ({
  PushNotificationService: class PushNotificationService {},
}));
jest.mock(
  '@core/repositories/chat/ChatClosureCommentCreator.repository',
  () => ({
    ChatClosureCommentCreatorRepository: class ChatClosureCommentCreatorRepository {},
  })
);
jest.mock('@core/services/attendanceInactivity.service', () => ({
  AttendanceInactivityService: class AttendanceInactivityService {},
}));
jest.mock('@core/services/chatUser.service', () => ({
  ChatUserService: class ChatUserService {},
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatStatusUpdaterUseCase } from '@core/useCases/chat/ChatStatusUpdater.useCase';

describe('ChatStatusUpdaterUseCase retry idempotency', () => {
  it('moves a queued chat into attendance and publishes the confirmed transition', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Channel' },
      user: null,
      secondary_users: [],
      sector: null,
      contact: null,
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.queue,
      date: '2026-07-11T10:00:00.000Z',
      started_at: null,
      summary: {
        last_message: 'Olá',
        last_message_id: 'message-1',
        last_date: '2026-07-11T10:01:00.000Z',
        unread_count: 2,
        revision: 4,
      },
    } as IChat;
    const saveChat = jest.fn(async (_chat: IChat, _options: unknown) => true);
    const clearChatSummary = jest.fn(
      async (_chatId: string, _accountId: string, _options: unknown) => true
    );
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      countInChatChatsByUserId: jest.fn(async () => 0),
      saveChat,
      clearChatSummary,
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const centrifugoService = { publishSub: jest.fn(async () => undefined) };
    const userService = {
      viewUserNamePhoto: jest.fn(async () => ({
        id: 'user-1',
        name: 'Agent',
        photo: null,
      })),
    };
    const workerService = {
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({
        allow_attendance_only_online: false,
        generate_protocol_at_start: null,
      })),
    };
    const workerConfigService = {
      viewSimultaneousAttendance: jest.fn(async () => 0),
    };
    const attendanceInactivityService = {
      startTrackingOnInChatEntry: jest.fn(async () => undefined),
      cancelInactivityTrackingForEndedAttendance: jest.fn(
        async () => undefined
      ),
    };
    const useCase = new ChatStatusUpdaterUseCase(
      chatService as never,
      centrifugoService as never,
      userService as never,
      workerService as never,
      workerConfigService as never,
      { sendMessage: jest.fn(async () => undefined) } as never,
      {} as never,
      { clearFlowCacheForChat: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      attendanceInactivityService as never,
      {} as never
    );

    const result = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      null,
      [],
      { chat_id: 'chat-1' },
      { status: EChatStatus.in_chat },
      [],
      []
    );

    expect(result).toEqual(
      expect.objectContaining({
        chat_id: 'chat-1',
        status: EChatStatus.in_chat,
        user: expect.objectContaining({ id: 'user-1', name: 'Agent' }),
        summary: expect.objectContaining({ unread_count: 0 }),
      })
    );
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(saveChat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        status: EChatStatus.in_chat,
        user: expect.objectContaining({ id: 'user-1' }),
      })
    );
    expect(saveChat.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        refresh: true,
        outboundWebhook: expect.objectContaining({
          eventTypes: expect.arrayContaining(['chat.attended']),
        }),
      })
    );
    expect(clearChatSummary).toHaveBeenCalledWith(
      'chat-1',
      'account-1',
      expect.objectContaining({
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 4,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-1',
      })
    );
    expect(
      attendanceInactivityService.startTrackingOnInChatEntry
    ).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
  });

  it('returns the canonical chat without repeating effects when status is already applied', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Channel' },
      user: { id: 'user-1', name: 'Agent', photo: null },
      secondary_users: [],
      sector: null,
      contact: null,
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-11T10:00:00.000Z',
      started_at: '2026-07-11T10:00:00.000Z',
    } as IChat;
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      saveChat: jest.fn(async () => true),
      clearChatSummary: jest.fn(async () => undefined),
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const centrifugoService = { publishSub: jest.fn(async () => undefined) };
    const chatMessageService = { sendMessage: jest.fn(async () => undefined) };
    const attendanceInactivityService = {
      startTrackingOnInChatEntry: jest.fn(async () => undefined),
      cancelInactivityTrackingForEndedAttendance: jest.fn(
        async () => undefined
      ),
    };
    const useCase = new ChatStatusUpdaterUseCase(
      chatService as never,
      centrifugoService as never,
      {} as never,
      {} as never,
      {} as never,
      chatMessageService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      attendanceInactivityService as never,
      {} as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        null,
        [],
        { chat_id: 'chat-1' },
        { status: EChatStatus.in_chat },
        [],
        []
      )
    ).resolves.toBe(chat);

    expect(chatService.saveChat).not.toHaveBeenCalled();
    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(
      attendanceInactivityService.startTrackingOnInChatEntry
    ).not.toHaveBeenCalled();
  });

  it('clears every AI embedding marker when a closed chat is reopened', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Channel' },
      user: { id: 'user-1', name: 'Agent', photo: null },
      secondary_users: [],
      sector: null,
      contact: null,
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.closed,
      date: '2026-07-11T10:00:00.000Z',
      started_at: '2026-07-11T10:00:00.000Z',
      closed_at: '2026-07-11T11:00:00.000Z',
      embedded_for_ai_agents: ['agent-1', 'agent-2'],
      summary: {
        last_message: 'Encerrado',
        last_message_id: 'message-2',
        last_date: '2026-07-11T11:00:00.000Z',
        unread_count: 0,
        revision: 5,
      },
    } as IChat;
    const saveChat = jest.fn(async (_chat: IChat, _options: unknown) => true);
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      findOpenChatByIdentity: jest.fn(async () => null),
      countInChatChatsByUserId: jest.fn(async () => 0),
      saveChat,
      clearChatSummary: jest.fn(async () => true),
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({
        allow_attendance_only_online: false,
        generate_protocol_at_start: null,
      })),
    };
    const attendanceInactivityService = {
      startTrackingOnInChatEntry: jest.fn(async () => undefined),
      cancelInactivityTrackingForEndedAttendance: jest.fn(
        async () => undefined
      ),
    };
    const useCase = new ChatStatusUpdaterUseCase(
      chatService as never,
      { publishSub: jest.fn(async () => undefined) } as never,
      {
        viewUserNamePhoto: jest.fn(async () => ({
          id: 'user-1',
          name: 'Agent',
          photo: null,
        })),
      } as never,
      workerService as never,
      { viewSimultaneousAttendance: jest.fn(async () => 0) } as never,
      { sendMessage: jest.fn(async () => undefined) } as never,
      {} as never,
      { clearFlowCacheForChat: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      attendanceInactivityService as never,
      {} as never
    );

    const result = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      null,
      [],
      { chat_id: 'chat-1' },
      { status: EChatStatus.in_chat },
      [
        {
          account_id: 'account-1',
          permission_role_id: 'role-1',
          role_name: 'Operator',
          module_name: 'chat',
          action_name: EChatPermissions.reopen_chat,
        },
      ],
      []
    );

    expect(result?.embedded_for_ai_agents).toEqual([]);
    expect(saveChat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        status: EChatStatus.in_chat,
        embedded_for_ai_agents: [],
      })
    );
  });
});
