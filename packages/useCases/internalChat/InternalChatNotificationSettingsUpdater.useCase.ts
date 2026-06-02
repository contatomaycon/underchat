import { inject, injectable } from 'tsyringe';
import { InternalChatNotificationSettingsRepository } from '@core/repositories/internalChat/InternalChatNotificationSettings.repository';
import { InternalChatNotificationSettingsRequest } from '@core/schema/internalChat/notificationSettings/request.schema';

@injectable()
export class InternalChatNotificationSettingsUpdaterUseCase {
  constructor(
    @inject(InternalChatNotificationSettingsRepository)
    private readonly repository: InternalChatNotificationSettingsRepository
  ) {}

  async execute(
    userId: string,
    input: InternalChatNotificationSettingsRequest
  ) {
    return this.repository.updateByUserId(userId, input);
  }
}
