import 'reflect-metadata';
import { ChatUserService } from '@core/services/chatUser.service';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

describe('ChatUserService', () => {
  it('delegates view and update methods to repositories', async () => {
    const viewChatUser = jest.fn(async () => ({ chat_user_id: 'cu-1' }));
    const updateChatUser = jest.fn(async () => true);
    const service = new ChatUserService(
      { viewChatUser } as never,
      { updateChatUser } as never
    );

    await expect(service.viewChatUser('u-1')).resolves.toEqual({
      chat_user_id: 'cu-1',
    });
    await expect(service.updateChatUser('u-1', {} as never)).resolves.toBe(
      true
    );
  });
});
