import * as schema from '@core/models';
import { notifications, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { isNull } from 'drizzle-orm';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';

@injectable()
export class NotificationsViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewNotifications = async (): Promise<ListNotificationsResponse> => {
    const result = await this.db.query.notifications.findFirst({
      where: isNull(notifications.deleted_at),
      with: {
        ntw: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
        npw: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
        new: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
      },
      columns: {
        notification_id: true,
        two_factor_notification: true,
        plan_notification: true,
        plan_expiration_reminder: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!result) {
      return {
        notification_id: null,
        two_factor_notification: null,
        plan_notification: null,
        plan_expiration_reminder: null,
        created_at: null,
        updated_at: null,
      };
    }

    return {
      notification_id: result.notification_id,
      two_factor_notification: result.ntw
        ? {
            worker_id: result.ntw.worker_id,
            name: result.ntw.name,
          }
        : null,
      plan_notification: result.npw
        ? {
            worker_id: result.npw.worker_id,
            name: result.npw.name,
          }
        : null,
      plan_expiration_reminder: result.new
        ? {
            worker_id: result.new.worker_id,
            name: result.new.name,
          }
        : null,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  };
}
