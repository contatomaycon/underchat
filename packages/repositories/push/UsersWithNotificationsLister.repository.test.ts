import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { canReceivePushForChatStatus } from './UsersWithNotificationsLister.repository';

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
});
