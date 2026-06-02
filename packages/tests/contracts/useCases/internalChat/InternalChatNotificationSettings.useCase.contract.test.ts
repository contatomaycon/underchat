import 'reflect-metadata';

jest.mock(
  '@core/repositories/internalChat/InternalChatNotificationSettings.repository',
  () => ({
    InternalChatNotificationSettingsRepository: class InternalChatNotificationSettingsRepository {},
  })
);

import { InternalChatNotificationSettingsUpdaterUseCase } from '@core/useCases/internalChat/InternalChatNotificationSettingsUpdater.useCase';
import { InternalChatNotificationSettingsViewerUseCase } from '@core/useCases/internalChat/InternalChatNotificationSettingsViewer.useCase';

const settings = {
  chat_user_id: 'chat-user-1',
  notifications_internal_chat: true,
  notifications_internal_chat_direct: true,
  notifications_internal_chat_group: true,
  notifications_internal_chat_sound: true,
  notifications_internal_chat_toast: true,
  notifications_internal_chat_browser: true,
  notifications_internal_chat_push: true,
};

describe('InternalChatNotificationSettings use cases', () => {
  it('views internal chat notification settings by user id', async () => {
    const repository = {
      viewByUserId: jest.fn().mockResolvedValue(settings),
    };
    const useCase = new InternalChatNotificationSettingsViewerUseCase(
      repository as never
    );

    await expect(useCase.execute('user-1')).resolves.toEqual(settings);
    expect(repository.viewByUserId).toHaveBeenCalledWith('user-1');
  });

  it('updates internal chat notification settings partially', async () => {
    const updated = {
      ...settings,
      notifications_internal_chat_group: false,
    };
    const repository = {
      updateByUserId: jest.fn().mockResolvedValue(updated),
    };
    const useCase = new InternalChatNotificationSettingsUpdaterUseCase(
      repository as never
    );
    const input = {
      notifications_internal_chat_group: false,
    };

    await expect(useCase.execute('user-1', input)).resolves.toEqual(updated);
    expect(repository.updateByUserId).toHaveBeenCalledWith('user-1', input);
  });
});
