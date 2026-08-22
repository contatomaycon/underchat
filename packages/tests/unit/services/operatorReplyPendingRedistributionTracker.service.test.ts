import 'reflect-metadata';
import { OperatorReplyPendingRedistributionTrackerService } from '@core/services/operatorReplyPendingRedistributionTracker.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IChat } from '@core/common/interfaces/IChat';

const chat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Channel' },
  sector: { id: 'sector-1', name: 'Sales' },
  user: { id: 'user-1', name: 'Seller' },
  status: EChatStatus.in_chat,
  date: '2026-07-25T10:00:00.000Z',
  name: 'Contact',
  phone: '5511999999999',
  summary: {
    revision: 2,
    last_message: 'Olá',
    last_date: '2026-07-25T10:00:00.000Z',
    last_message_id: 'message-1',
    operator_reply_pending_since: '2026-07-25T10:00:00.000Z',
    unread_count: 1,
  },
} as IChat;

describe('OperatorReplyPendingRedistributionTrackerService', () => {
  it('does not schedule when the configuration is disabled', async () => {
    const redis = { eval: jest.fn() };
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: false,
        time_minutes: 15,
        sector_ids: [],
      }),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      redis as never,
      config as never
    );

    await expect(tracker.scheduleForNewContactMessage(chat)).resolves.toBe(
      false
    );
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('atomically keeps the first pending deadline on subsequent messages', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
    };
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: [],
      }),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      redis as never,
      config as never
    );

    await expect(tracker.scheduleForNewContactMessage(chat)).resolves.toBe(
      true
    );
    const summary = chat.summary;
    if (!summary) throw new Error('test chat summary is required');
    await expect(
      tracker.scheduleForNewContactMessage({
        ...chat,
        summary: {
          ...summary,
          last_message_id: 'message-2',
          last_date: '2026-07-25T10:01:00.000Z',
        },
      })
    ).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    const firstCall = redis.eval.mock.calls[0];
    expect(firstCall[2]).toContain(
      'underchat:operator-reply-pending-redistribution:account-1:worker-1:chat-1'
    );
    expect(firstCall.at(-1)).toBe(
      String(new Date('2026-07-25T10:00:00.000Z').getTime() + 15 * 60_000)
    );
  });

  it('schedules only chats that belong to one of the configured sectors', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(1) };
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: ['sector-1', 'sector-2'],
      }),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      redis as never,
      config as never
    );

    await expect(tracker.scheduleForNewContactMessage(chat)).resolves.toBe(
      true
    );
    await expect(
      tracker.scheduleForNewContactMessage({
        ...chat,
        sector: { id: 'sector-3', name: 'Support' },
      })
    ).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('keeps a tracked conversation active when it moves between selected sectors', async () => {
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: ['sector-1', 'sector-2'],
      }),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      {} as never,
      config as never
    );
    jest.spyOn(tracker, 'get').mockResolvedValue({
      account_id: 'account-1',
      worker_id: 'worker-1',
      chat_id: 'chat-1',
      tracking_id: 'tracking-1',
      pending_since: '2026-07-25T10:00:00.000Z',
      redistribution_count: 0,
      retry_count: 0,
      stage: 'waiting',
      expected_primary_user_id: 'user-1',
      expected_assignment_event_id: null,
      expected_assignment_epoch: null,
      expected_status_event_id: null,
      expected_status_epoch: null,
      expected_last_message_id: 'message-1',
      expected_summary_revision: 2,
    });
    const save = jest.spyOn(tracker, 'save').mockResolvedValue();
    const remove = jest.spyOn(tracker, 'remove').mockResolvedValue();

    await tracker.handleChatTransition({
      ...chat,
      sector: { id: 'sector-2', name: 'Success' },
    });

    expect(save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ expected_primary_user_id: 'user-1' }),
      expect.any(Number)
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not create tracking retroactively when a pending chat enters a selected sector', async () => {
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn(),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      {} as never,
      config as never
    );
    jest.spyOn(tracker, 'get').mockResolvedValue(null);
    const save = jest.spyOn(tracker, 'save').mockResolvedValue();

    await tracker.handleChatTransition({
      ...chat,
      sector: { id: 'sector-2', name: 'Success' },
    });

    expect(
      config.viewOperatorReplyPendingRedistribution
    ).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('removes tracking when the conversation leaves all configured sectors', async () => {
    const config = {
      viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
        enabled: true,
        time_minutes: 15,
        sector_ids: ['sector-1', 'sector-2'],
      }),
    };
    const tracker = new OperatorReplyPendingRedistributionTrackerService(
      {} as never,
      config as never
    );
    jest.spyOn(tracker, 'get').mockResolvedValue({} as never);
    const save = jest.spyOn(tracker, 'save').mockResolvedValue();
    const remove = jest.spyOn(tracker, 'remove').mockResolvedValue();

    await tracker.handleChatTransition({
      ...chat,
      sector: { id: 'sector-3', name: 'Support' },
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
