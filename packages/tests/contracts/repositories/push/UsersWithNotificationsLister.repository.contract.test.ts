import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import {
  canReceivePushForChatStatus,
  isChatbotNotificationStatus,
  UsersWithNotificationsListerRepository,
} from '@core/repositories/push/UsersWithNotificationsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

const enabledPreferences = {
  notifications: true,
  notifications_push: true,
  notifications_status_update: true,
  notifications_status_queue: true,
  notifications_status_in_chat: true,
  notifications_status_chatbot: true,
};

describe('canReceivePushForChatStatus', () => {
  it('blocks push when master notifications are disabled', () => {
    expect(
      canReceivePushForChatStatus({
        ...enabledPreferences,
        notifications: false,
      })
    ).toBe(false);
  });

  it('blocks push when background push is disabled', () => {
    expect(
      canReceivePushForChatStatus({
        ...enabledPreferences,
        notifications_push: false,
      })
    ).toBe(false);
  });

  it('blocks queue push when queue notifications are disabled', () => {
    expect(
      canReceivePushForChatStatus(
        {
          ...enabledPreferences,
          notifications_status_queue: false,
        },
        EChatStatus.queue
      )
    ).toBe(false);
  });

  it('blocks in-chat push when in-chat notifications are disabled', () => {
    expect(
      canReceivePushForChatStatus(
        {
          ...enabledPreferences,
          notifications_status_in_chat: false,
        },
        EChatStatus.in_chat
      )
    ).toBe(false);
  });

  it('blocks chatbot push when chatbot notifications are disabled', () => {
    expect(
      canReceivePushForChatStatus(
        {
          ...enabledPreferences,
          notifications_status_chatbot: false,
        },
        EChatStatus.ura
      )
    ).toBe(false);
  });

  it('blocks status push when the status parent toggle is disabled', () => {
    expect(
      canReceivePushForChatStatus(
        {
          ...enabledPreferences,
          notifications_status_update: false,
        },
        EChatStatus.queue,
        true
      )
    ).toBe(false);
  });

  it('allows push when all required preferences are enabled', () => {
    expect(canReceivePushForChatStatus(enabledPreferences)).toBe(true);
  });
});

describe('isChatbotNotificationStatus', () => {
  it('returns true for chatbot statuses and false for others', () => {
    expect(isChatbotNotificationStatus(EChatStatus.ura)).toBe(true);
    expect(isChatbotNotificationStatus(EChatStatus.ura_output)).toBe(true);
    expect(isChatbotNotificationStatus(EChatStatus.ura_schedule)).toBe(true);
    expect(isChatbotNotificationStatus(EChatStatus.ura_webhook)).toBe(true);
    expect(isChatbotNotificationStatus(EChatStatus.in_chat)).toBe(false);
    expect(isChatbotNotificationStatus()).toBe(false);
  });
});

describe('UsersWithNotificationsListerRepository', () => {
  it('returns user ids from the query result', async () => {
    const { db, execute } = createSelectDbMock([
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ]);

    const repository = new UsersWithNotificationsListerRepository(db as never);

    await expect(
      repository.listUsersWithNotifications('account-1')
    ).resolves.toEqual(['user-1', 'user-2']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no rows are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new UsersWithNotificationsListerRepository(db as never);

    await expect(
      repository.listUsersWithNotifications('account-1')
    ).resolves.toEqual([]);
  });

  it('executes queries for all status-branch combinations', async () => {
    const { db, where } = createSelectDbMock([{ user_id: 'user-1' }]);
    const repository = new UsersWithNotificationsListerRepository(db as never);

    await repository.listUsersWithNotifications('account-1', EChatStatus.queue);
    await repository.listUsersWithNotifications(
      'account-1',
      EChatStatus.in_chat,
      true
    );
    await repository.listUsersWithNotifications('account-1', EChatStatus.ura);

    expect(where).toHaveBeenCalledTimes(3);
  });

  it('skips internal chat query when there are no participants', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new UsersWithNotificationsListerRepository(db as never);

    await expect(
      repository.listInternalChatUsersWithNotifications(
        'account-1',
        [],
        EInternalChatConversationType.group
      )
    ).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns internal chat notification user ids from active participants', async () => {
    const { db, execute, where } = createSelectDbMock([
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ]);
    const repository = new UsersWithNotificationsListerRepository(db as never);

    await expect(
      repository.listInternalChatUsersWithNotifications(
        'account-1',
        ['user-1', 'user-2', 'sender-1'],
        EInternalChatConversationType.direct
      )
    ).resolves.toEqual(['user-1', 'user-2']);
    expect(where).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
