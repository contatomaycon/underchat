import 'reflect-metadata';
import { OperatorReplyPendingRedistributionService } from '@core/services/operatorReplyPendingRedistribution.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { IChat } from '@core/common/interfaces/IChat';
import { IOperatorReplyPendingRedistributionData } from '@core/common/interfaces/IOperatorReplyPendingRedistributionData';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/common/functions/createI18nInstance', () => ({
  createI18nInstance: jest.fn().mockResolvedValue((key: string) => key),
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, operation: () => Promise<unknown>) =>
      operation()
  ),
}));

const pendingSince = '2026-07-25T10:00:00.000Z';
const originalChat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Channel' },
  sector: { id: 'sector-1', name: 'Sales' },
  user: { id: 'user-1', name: 'Current seller' },
  secondary_users: [{ id: 'legacy-secondary', name: 'Legacy' }],
  status: EChatStatus.in_chat,
  date: pendingSince,
  name: 'Contact',
  phone: '5511999999999',
  summary: {
    revision: 1,
    last_message: 'Olá',
    last_date: pendingSince,
    last_message_id: 'message-1',
    operator_reply_pending_since: pendingSince,
    unread_count: 1,
  },
} as IChat;

const tracking: IOperatorReplyPendingRedistributionData = {
  account_id: 'account-1',
  worker_id: 'worker-1',
  chat_id: 'chat-1',
  tracking_id: 'tracking-1',
  pending_since: pendingSince,
  redistribution_count: 0,
  retry_count: 0,
  stage: 'waiting',
  expected_primary_user_id: 'user-1',
  expected_assignment_event_id: null,
  expected_assignment_epoch: null,
  expected_status_event_id: null,
  expected_status_epoch: null,
  expected_last_message_id: 'message-1',
  expected_summary_revision: 1,
};

describe('OperatorReplyPendingRedistributionService', () => {
  it('keeps the tracking active and retries after the configured interval when no eligible seller remains', async () => {
    const tracker = {
      reconcile: jest.fn(),
      listDue: jest.fn().mockResolvedValue(['payload-key']),
      get: jest.fn().mockResolvedValue(tracking),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const chatService = {
      findChatByChatId: jest.fn().mockResolvedValue(originalChat),
      countInChatChatsByUserId: jest.fn(),
      reassignPendingOperatorReply: jest.fn(),
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    const workerConfig = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: [],
      }),
      viewSimultaneousAttendance: jest
        .fn()
        .mockResolvedValue({ enabled: true, simultaneous_attendance: 5 }),
    };
    const candidateRepository = {
      listActiveUsers: jest.fn().mockResolvedValue([
        { id: 'user-1', name: 'Current seller' },
        { id: 'user-2', name: 'Seller without channel access' },
        { id: 'user-3', name: 'Offline seller' },
      ]),
    };
    const presence = {
      getStatus: jest.fn(async (userId: string) =>
        userId === 'user-3' ? EChatUserStatus.offline : EChatUserStatus.online
      ),
    };
    const service = new OperatorReplyPendingRedistributionService(
      redis as never,
      tracker as never,
      chatService as never,
      workerConfig as never,
      {
        listUserIdsWithAccessToChannel: jest
          .fn()
          .mockResolvedValue(['user-1', 'user-3']),
      } as never,
      presence as never,
      candidateRepository as never,
      {
        listSectorUsersForTransfer: jest
          .fn()
          .mockResolvedValue([
            { id: 'user-1' },
            { id: 'user-2' },
            { id: 'user-3' },
          ]),
      } as never,
      { sendMessage: jest.fn().mockResolvedValue(true) } as never,
      { publishSub: jest.fn().mockResolvedValue(undefined) } as never,
      {
        sendNotificationForChatTransfer: jest.fn().mockResolvedValue(undefined),
      } as never
    );

    await service.processScheduledRedistributions();

    expect(chatService.reassignPendingOperatorReply).not.toHaveBeenCalled();
    expect(tracker.remove).not.toHaveBeenCalled();
    expect(tracker.save).toHaveBeenCalledWith(
      'payload-key',
      expect.objectContaining({
        stage: 'waiting',
        retry_count: 0,
        expected_primary_user_id: 'user-1',
      }),
      expect.any(Number)
    );
    const dueAt = tracker.save.mock.calls[0][2] as number;
    expect(dueAt).toBeGreaterThanOrEqual(Date.now() + 15 * 60_000 - 1_000);
    expect(dueAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1_000);
  });

  it('selects only an active online sector/channel candidate and advances the cursor after CAS', async () => {
    const tracker = {
      reconcile: jest.fn(),
      listDue: jest.fn().mockResolvedValue(['payload-key']),
      get: jest.fn().mockResolvedValue(tracking),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const redistributedChat: IChat = {
      ...originalChat,
      user: { id: 'user-3', name: 'Eligible seller' },
      secondary_users: [],
      meta: {
        assignment_event_id: 'placeholder',
        assignment_epoch: Date.now(),
      },
    };
    const chatService = {
      findChatByChatId: jest
        .fn()
        .mockResolvedValueOnce(originalChat)
        .mockResolvedValue(redistributedChat),
      countInChatChatsByUserId: jest.fn().mockResolvedValue(0),
      reassignPendingOperatorReply: jest
        .fn()
        .mockImplementation(async (input: { eventId: string }) => ({
          applied: true,
          chat: {
            ...redistributedChat,
            meta: {
              assignment_event_id: input.eventId,
              assignment_epoch: Date.now(),
            },
          },
        })),
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    const workerConfig = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: ['sector-1', 'sector-2'],
      }),
      viewSimultaneousAttendance: jest
        .fn()
        .mockResolvedValue({ enabled: true, simultaneous_attendance: 5 }),
    };
    const candidateRepository = {
      listActiveUsers: jest.fn().mockResolvedValue([
        { id: 'user-1', name: 'Current seller' },
        { id: 'user-2', name: 'Offline seller' },
        { id: 'user-3', name: 'Eligible seller' },
        { id: 'user-4', name: 'Wrong sector' },
      ]),
    };
    const presence = {
      getStatus: jest.fn(async (userId: string) =>
        userId === 'user-3' ? EChatUserStatus.online : EChatUserStatus.offline
      ),
    };
    const service = new OperatorReplyPendingRedistributionService(
      redis as never,
      tracker as never,
      chatService as never,
      workerConfig as never,
      {
        listUserIdsWithAccessToChannel: jest
          .fn()
          .mockResolvedValue(['user-1', 'user-2', 'user-3', 'user-4']),
      } as never,
      presence as never,
      candidateRepository as never,
      {
        listSectorUsersForTransfer: jest
          .fn()
          .mockResolvedValue([
            { id: 'user-1' },
            { id: 'user-2' },
            { id: 'user-3' },
          ]),
      } as never,
      { sendMessage: jest.fn().mockResolvedValue(true) } as never,
      { publishSub: jest.fn().mockResolvedValue(undefined) } as never,
      {
        sendNotificationForChatTransfer: jest.fn().mockResolvedValue(undefined),
      } as never
    );

    await service.processScheduledRedistributions();

    expect(candidateRepository.listActiveUsers).toHaveBeenCalled();
    expect(presence.getStatus).toHaveBeenCalledWith('user-3');
    expect(chatService.countInChatChatsByUserId).toHaveBeenCalled();
    expect(chatService.reassignPendingOperatorReply).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPrimaryUserId: 'user-1',
        nextUser: expect.objectContaining({ id: 'user-3' }),
      })
    );
    expect(redistributedChat).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user-3' }),
        secondary_users: [],
      })
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(':account-1:worker-1:sector-1'),
      'user-3'
    );
    expect(tracker.save).toHaveBeenCalledWith(
      'payload-key',
      expect.objectContaining({
        stage: 'waiting',
        redistribution_count: 1,
      }),
      expect.any(Number)
    );
  });

  it('removes a due redistribution when the conversation is outside every configured sector', async () => {
    const tracker = {
      reconcile: jest.fn(),
      listDue: jest.fn().mockResolvedValue(['payload-key']),
      get: jest.fn().mockResolvedValue(tracking),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const chatService = {
      findChatByChatId: jest.fn().mockResolvedValue(originalChat),
      countInChatChatsByUserId: jest.fn(),
      reassignPendingOperatorReply: jest.fn(),
    };
    const candidateRepository = {
      listActiveUsers: jest.fn(),
    };
    const sectorService = {
      listSectorUsersForTransfer: jest.fn(),
    };
    const service = new OperatorReplyPendingRedistributionService(
      {} as never,
      tracker as never,
      chatService as never,
      {
        viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
          enabled: true,
          time_minutes: 15,
          sector_ids: ['sector-2', 'sector-3'],
        }),
      } as never,
      {} as never,
      {} as never,
      candidateRepository as never,
      sectorService as never,
      {} as never,
      {} as never,
      {} as never
    );

    await service.processScheduledRedistributions();

    expect(tracker.remove).toHaveBeenCalledWith('payload-key');
    expect(chatService.reassignPendingOperatorReply).not.toHaveBeenCalled();
    expect(candidateRepository.listActiveUsers).not.toHaveBeenCalled();
    expect(sectorService.listSectorUsersForTransfer).not.toHaveBeenCalled();
  });
});
