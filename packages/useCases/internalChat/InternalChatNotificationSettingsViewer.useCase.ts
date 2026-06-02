import { inject, injectable } from 'tsyringe';
import { InternalChatNotificationSettingsRepository } from '@core/repositories/internalChat/InternalChatNotificationSettings.repository';

@injectable()
export class InternalChatNotificationSettingsViewerUseCase {
  constructor(
    @inject(InternalChatNotificationSettingsRepository)
    private readonly repository: InternalChatNotificationSettingsRepository
  ) {}

  async execute(userId: string) {
    return this.repository.viewByUserId(userId);
  }
}
