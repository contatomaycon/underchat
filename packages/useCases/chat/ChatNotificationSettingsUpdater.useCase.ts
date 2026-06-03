import { inject, injectable } from 'tsyringe';
import { ChatNotificationSettingsRepository } from '@core/repositories/chat/ChatNotificationSettings.repository';
import { ChatNotificationSettingsRequest } from '@core/schema/chat/notificationSettings/request.schema';

@injectable()
export class ChatNotificationSettingsUpdaterUseCase {
  constructor(
    @inject(ChatNotificationSettingsRepository)
    private readonly repository: ChatNotificationSettingsRepository
  ) {}

  async execute(userId: string, input: ChatNotificationSettingsRequest) {
    return this.repository.updateByUserId(userId, input);
  }
}
