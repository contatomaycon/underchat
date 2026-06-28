import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ChatUserCreatorRepository } from '@core/repositories/chat/ChatUserCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ChatUserCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('chat-user-id-1');
  });

  it('returns true when insert affects one row', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new ChatUserCreatorRepository({} as never);

    await expect(
      repository.createChatUser(tx as never, 'user-1')
    ).resolves.toBe(true);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_user_id: 'chat-user-id-1',
        user_id: 'user-1',
        notifications: true,
        notifications_vibrate: false,
        notifications_message_queue: false,
        notifications_message_in_chat: true,
        notifications_message_chatbot: false,
        notifications_transfer: true,
        notifications_internal_chat: true,
        notifications_internal_chat_direct: true,
        notifications_internal_chat_group: true,
        notifications_internal_chat_sound: true,
        notifications_internal_chat_vibrate: false,
        notifications_internal_chat_toast: true,
        notifications_internal_chat_browser: true,
        notifications_internal_chat_push: true,
      })
    );
  });

  it('returns false when insert affects zero rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new ChatUserCreatorRepository({} as never);

    await expect(
      repository.createChatUser(tx as never, 'user-1')
    ).resolves.toBe(false);
  });
});
