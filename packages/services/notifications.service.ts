import { injectable, inject } from 'tsyringe';
import { NotificationsViewerRepository } from '@core/repositories/notifications/NotificationsViewer.repository';
import { NotificationsUpserterRepository } from '@core/repositories/notifications/NotificationsUpserter.repository';
import { NotificationsWorkersListerRepository } from '@core/repositories/notifications/NotificationsWorkersLister.repository';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';

@injectable()
export class NotificationsService {
  constructor(
    @inject(NotificationsViewerRepository)
    private readonly notificationsViewerRepository: NotificationsViewerRepository,
    @inject(NotificationsUpserterRepository)
    private readonly notificationsUpserterRepository: NotificationsUpserterRepository,
    @inject(NotificationsWorkersListerRepository)
    private readonly notificationsWorkersListerRepository: NotificationsWorkersListerRepository
  ) {}

  viewNotifications = async (): Promise<ListNotificationsResponse> => {
    return this.notificationsViewerRepository.viewNotifications();
  };

  upsertNotifications = async (
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> => {
    return this.notificationsUpserterRepository.upsertNotifications(input);
  };

  listWorkersByAccount = async (
    accountId: string
  ): Promise<ListWorkersResponse> => {
    return this.notificationsWorkersListerRepository.listWorkersByAccount(
      accountId
    );
  };
}
