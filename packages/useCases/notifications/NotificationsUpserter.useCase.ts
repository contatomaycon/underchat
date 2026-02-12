import { injectable, inject } from 'tsyringe';
import { NotificationsService } from '@core/services/notifications.service';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';

@injectable()
export class NotificationsUpserterUseCase {
  constructor(
    @inject(NotificationsService)
    private readonly notificationsService: NotificationsService
  ) {}

  async execute(
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> {
    return this.notificationsService.upsertNotifications(input);
  }
}
