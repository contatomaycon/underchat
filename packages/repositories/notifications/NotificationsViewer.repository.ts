import * as schema from '@core/models';
import { notifications, notificationType } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { isNull, eq, and } from 'drizzle-orm';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { ENotificationType } from '@core/common/enums/ENotificationType';

@injectable()
export class NotificationsViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewNotifications = async (): Promise<ListNotificationsResponse> => {
    const twoFactorTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.two_factor
    );
    const planTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan
    );
    const planExpirationTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan_expiration
    );

    const twoFactorNotification =
      await this.findNotificationByType(twoFactorTypeId);
    const planNotification = await this.findNotificationByType(planTypeId);
    const planExpirationNotification =
      await this.findNotificationByType(planExpirationTypeId);

    const firstNotificationId =
      twoFactorNotification?.notification_id ||
      planNotification?.notification_id ||
      planExpirationNotification?.notification_id ||
      null;

    return {
      notification_id: firstNotificationId,
      two_factor_notification: twoFactorNotification
        ? {
            worker_id: twoFactorNotification.nwr?.worker_id || null,
            name: twoFactorNotification.nwr?.name || null,
            message: twoFactorNotification.message || null,
          }
        : null,
      plan_notification: planNotification
        ? {
            worker_id: planNotification.nwr?.worker_id || null,
            name: planNotification.nwr?.name || null,
            message: planNotification.message || null,
          }
        : null,
      plan_expiration_reminder: planExpirationNotification
        ? {
            worker_id: planExpirationNotification.nwr?.worker_id || null,
            name: planExpirationNotification.nwr?.name || null,
            message: planExpirationNotification.message || null,
          }
        : null,
      created_at: twoFactorNotification?.created_at || null,
      updated_at:
        twoFactorNotification?.updated_at ||
        planNotification?.updated_at ||
        planExpirationNotification?.updated_at ||
        null,
    };
  };

  private async findNotificationTypeIdByName(name: string): Promise<string> {
    const result = await this.db
      .select({ notification_type_id: notificationType.notification_type_id })
      .from(notificationType)
      .where(eq(notificationType.name, name))
      .limit(1)
      .execute();

    if (!result.length || !result[0].notification_type_id) {
      throw new Error(`Notification type not found: ${name}`);
    }

    return result[0].notification_type_id;
  }

  private async findNotificationByType(notificationTypeId: string) {
    return this.db.query.notifications.findFirst({
      where: and(
        eq(notifications.notification_type_id, notificationTypeId),
        isNull(notifications.deleted_at)
      ),
      with: {
        nwr: {
          columns: {
            worker_id: true,
            name: true,
          },
        },
      },
      columns: {
        notification_id: true,
        message: true,
        created_at: true,
        updated_at: true,
      },
    });
  }
}
