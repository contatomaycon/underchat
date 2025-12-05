import { injectable } from 'tsyringe';
import { NotificationsService } from '@core/services/notifications.service';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';

@injectable()
export class NotificationsViewerUseCase {
  constructor(private readonly notificationsService: NotificationsService) {}

  async execute(): Promise<ListNotificationsResponse> {
    return this.notificationsService.viewNotifications();
  }
}
