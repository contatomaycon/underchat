import 'reflect-metadata';
import { ChatNotificationSettingsRepository } from '@core/repositories/chat/ChatNotificationSettings.repository';
import { InternalChatNotificationSettingsRepository } from '@core/repositories/internalChat/InternalChatNotificationSettings.repository';

function createTransactionMock(row: Record<string, unknown>) {
  const selectExecute = jest.fn(async () => [row]);
  const selectChain = {} as {
    from: jest.Mock;
    where: jest.Mock;
    limit: jest.Mock;
    execute: jest.Mock;
  };
  selectChain.from = jest.fn(() => selectChain);
  selectChain.where = jest.fn(() => selectChain);
  selectChain.limit = jest.fn(() => selectChain);
  selectChain.execute = selectExecute;

  const updateExecute = jest.fn(async () => ({ rowCount: 1 }));
  const updateChain = {} as {
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  updateChain.set = jest.fn(() => updateChain);
  updateChain.where = jest.fn(() => updateChain);
  updateChain.execute = updateExecute;

  const tx = {
    select: jest.fn(() => selectChain),
    update: jest.fn(() => updateChain),
    insert: jest.fn(),
  };

  return { tx, updateSet: updateChain.set };
}

describe('ChatNotificationSettingsRepository', () => {
  it('persists all chat notification children as false when master is disabled', async () => {
    const { tx, updateSet } = createTransactionMock({
      chat_user_id: 'chat-user-1',
      notifications: false,
      notifications_sound: false,
      notifications_vibrate: false,
      notifications_toast: false,
      notifications_browser: false,
      notifications_push: false,
      notifications_message_queue: false,
      notifications_message_in_chat: false,
      notifications_message_chatbot: false,
      notifications_transfer: false,
    });
    const dbRw = {
      transaction: jest.fn(
        async (callback: (txInput: typeof tx) => Promise<unknown> | unknown) =>
          callback(tx)
      ),
    };
    const repository = new ChatNotificationSettingsRepository(
      {} as never,
      dbRw as never
    );

    await repository.updateByUserId('user-1', { notifications: false });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: false,
        notifications_sound: false,
        notifications_vibrate: false,
        notifications_toast: false,
        notifications_browser: false,
        notifications_push: false,
        notifications_message_queue: false,
        notifications_message_in_chat: false,
        notifications_message_chatbot: false,
        notifications_transfer: false,
      })
    );
  });
});

describe('InternalChatNotificationSettingsRepository', () => {
  it('persists all internal chat notification children as false when master is disabled', async () => {
    const { tx, updateSet } = createTransactionMock({
      chat_user_id: 'chat-user-1',
      notifications_internal_chat: false,
      notifications_internal_chat_direct: false,
      notifications_internal_chat_group: false,
      notifications_internal_chat_sound: false,
      notifications_internal_chat_vibrate: false,
      notifications_internal_chat_toast: false,
      notifications_internal_chat_browser: false,
      notifications_internal_chat_push: false,
    });
    const dbRw = {
      transaction: jest.fn(
        async (callback: (txInput: typeof tx) => Promise<unknown> | unknown) =>
          callback(tx)
      ),
    };
    const repository = new InternalChatNotificationSettingsRepository(
      {} as never,
      dbRw as never
    );

    await repository.updateByUserId('user-1', {
      notifications_internal_chat: false,
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications_internal_chat: false,
        notifications_internal_chat_direct: false,
        notifications_internal_chat_group: false,
        notifications_internal_chat_sound: false,
        notifications_internal_chat_vibrate: false,
        notifications_internal_chat_toast: false,
        notifications_internal_chat_browser: false,
        notifications_internal_chat_push: false,
      })
    );
  });
});
