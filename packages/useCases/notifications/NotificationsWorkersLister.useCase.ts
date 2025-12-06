import { injectable } from 'tsyringe';
import { NotificationsService } from '@core/services/notifications.service';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';

@injectable()
export class NotificationsWorkersListerUseCase {
  constructor(private readonly notificationsService: NotificationsService) {}

  async execute(accountId: string): Promise<ListWorkersResponse> {
    return this.notificationsService.listWorkersByAccount(accountId);
  }
}
