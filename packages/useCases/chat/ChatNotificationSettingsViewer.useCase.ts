import { inject, injectable } from 'tsyringe';
import { ChatNotificationSettingsRepository } from '@core/repositories/chat/ChatNotificationSettings.repository';

@injectable()
export class ChatNotificationSettingsViewerUseCase {
  constructor(
    @inject(ChatNotificationSettingsRepository)
    private readonly repository: ChatNotificationSettingsRepository
  ) {}

  async execute(userId: string) {
    return this.repository.viewByUserId(userId);
  }
}
