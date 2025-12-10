import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListSentNotificationsRequest } from '@core/schema/notifications/listSentNotifications/request.schema';
import {
  ListSentNotificationsFinalResponse,
  ListSentNotificationsResponse,
} from '@core/schema/notifications/listSentNotifications/response.schema';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';

@injectable()
export class ListSentNotificationsUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    query: ListSentNotificationsRequest
  ): Promise<ListSentNotificationsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort: [{ date: { order: 'desc' } }],
      query: {
        match_all: {},
      },
    };

    const result =
      await this.elasticDatabaseService.select<INotificationMessage>(
        EElasticIndex.notification,
        queryElastic
      );

    if (!result) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);
      return {
        pagings,
        results: [],
      };
    }

    const total = result.hits.total as { value: number; relation: string };
    const notifications = result.hits.hits.map((hit) => {
      const source = hit._source as INotificationMessage;
      return {
        id: source.id,
        notification_id: source.notification_id,
        notification_type: source.notification_type,
        account: source.account,
        worker: source.worker,
        name: source.name,
        phone: source.phone,
        email: source.email,
        message_whatsapp: source.message_whatsapp,
        message_email: source.message_email,
        email_subject: source.email_subject,
        date: source.date,
      } as ListSentNotificationsResponse;
    });

    const pagings = setPaginationData(
      notifications.length,
      total.value,
      perPage,
      currentPage
    );

    return {
      pagings,
      results: notifications,
    };
  }
}
