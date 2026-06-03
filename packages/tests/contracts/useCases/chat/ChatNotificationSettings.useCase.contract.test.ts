import 'reflect-metadata';

jest.mock(
  '@core/repositories/chat/ChatNotificationSettings.repository',
  () => ({
    ChatNotificationSettingsRepository: class ChatNotificationSettingsRepository {},
  })
);

import { ChatNotificationSettingsUpdaterUseCase } from '@core/useCases/chat/ChatNotificationSettingsUpdater.useCase';
import { ChatNotificationSettingsViewerUseCase } from '@core/useCases/chat/ChatNotificationSettingsViewer.useCase';

const settings = {
  chat_user_id: 'chat-user-1',
  notifications: true,
  notifications_sound: true,
  notifications_toast: true,
  notifications_browser: true,
  notifications_push: true,
  notifications_status_update: true,
  notifications_status_queue: false,
  notifications_status_in_chat: true,
  notifications_status_chatbot: false,
  notifications_message_queue: false,
  notifications_message_in_chat: true,
  notifications_message_chatbot: false,
  notifications_transfer: true,
};

describe('ChatNotificationSettings use cases', () => {
  it('views chat notification settings by user id', async () => {
    const repository = {
      viewByUserId: jest.fn().mockResolvedValue(settings),
    };
    const useCase = new ChatNotificationSettingsViewerUseCase(
      repository as never
    );

    await expect(useCase.execute('user-1')).resolves.toEqual(settings);
    expect(repository.viewByUserId).toHaveBeenCalledWith('user-1');
  });

  it('updates chat notification settings partially', async () => {
    const updated = {
      ...settings,
      notifications_message_queue: true,
      notifications_transfer: false,
    };
    const repository = {
      updateByUserId: jest.fn().mockResolvedValue(updated),
    };
    const useCase = new ChatNotificationSettingsUpdaterUseCase(
      repository as never
    );
    const input = {
      notifications_message_queue: true,
      notifications_transfer: false,
    };

    await expect(useCase.execute('user-1', input)).resolves.toEqual(updated);
    expect(repository.updateByUserId).toHaveBeenCalledWith('user-1', input);
  });
});
