import * as schema from '@core/models';
import { notifications } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class NotificationMessageViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findNotificationById = async (notificationId: string) => {
    return this.db.query.notifications.findFirst({
      where: and(
        eq(notifications.notification_id, notificationId),
        isNull(notifications.deleted_at)
      ),
      with: {
        nnt: {
          columns: {
            notification_type_id: true,
            name: true,
          },
        },
        nwr: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
      },
      columns: {
        notification_id: true,
        worker_id: true,
        notification_type_id: true,
        message_whatsapp: true,
        message_email: true,
        email_subject: true,
        created_at: true,
        updated_at: true,
      },
    });
  };

  findNotificationByTypeId = async (notificationTypeId: string) => {
    return this.db.query.notifications.findFirst({
      where: and(
        eq(notifications.notification_type_id, notificationTypeId),
        isNull(notifications.deleted_at)
      ),
      with: {
        nnt: {
          columns: {
            notification_type_id: true,
            name: true,
          },
        },
        nwr: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
      },
      columns: {
        notification_id: true,
        worker_id: true,
        notification_type_id: true,
        message_whatsapp: true,
        message_email: true,
        email_subject: true,
        created_at: true,
        updated_at: true,
      },
    });
  };
}
