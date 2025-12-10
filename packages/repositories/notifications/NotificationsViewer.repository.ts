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
    const planNewTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan_new
    );
    const planRenewalTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan_renewal
    );
    const planExpirationTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan_expiration
    );
    const planCancellationTypeId = await this.findNotificationTypeIdByName(
      ENotificationType.plan_cancellation
    );

    const twoFactorNotification =
      await this.findNotificationByType(twoFactorTypeId);
    const planNewNotification =
      await this.findNotificationByType(planNewTypeId);
    const planRenewalNotification =
      await this.findNotificationByType(planRenewalTypeId);
    const planExpirationNotification =
      await this.findNotificationByType(planExpirationTypeId);
    const planCancellationNotification = await this.findNotificationByType(
      planCancellationTypeId
    );

    const firstNotificationId =
      twoFactorNotification?.notification_id ||
      planNewNotification?.notification_id ||
      planRenewalNotification?.notification_id ||
      planExpirationNotification?.notification_id ||
      planCancellationNotification?.notification_id ||
      null;

    return {
      notification_id: firstNotificationId,
      two_factor_notification: twoFactorNotification
        ? {
            whatsapp: {
              worker_id: twoFactorNotification.nwr?.worker_id || null,
              name: twoFactorNotification.nwr?.name || null,
              message: twoFactorNotification.message_whatsapp || null,
            },
            email: {
              subject: twoFactorNotification.email_subject || null,
              message: twoFactorNotification.message_email || null,
            },
          }
        : null,
      plan_new_notification: planNewNotification
        ? {
            whatsapp: {
              worker_id: planNewNotification.nwr?.worker_id || null,
              name: planNewNotification.nwr?.name || null,
              message: planNewNotification.message_whatsapp || null,
            },
            email: {
              subject: planNewNotification.email_subject || null,
              message: planNewNotification.message_email || null,
            },
          }
        : null,
      plan_renewal_notification: planRenewalNotification
        ? {
            whatsapp: {
              worker_id: planRenewalNotification.nwr?.worker_id || null,
              name: planRenewalNotification.nwr?.name || null,
              message: planRenewalNotification.message_whatsapp || null,
            },
            email: {
              subject: planRenewalNotification.email_subject || null,
              message: planRenewalNotification.message_email || null,
            },
          }
        : null,
      plan_expiration_reminder: planExpirationNotification
        ? {
            whatsapp: {
              worker_id: planExpirationNotification.nwr?.worker_id || null,
              name: planExpirationNotification.nwr?.name || null,
              message: planExpirationNotification.message_whatsapp || null,
            },
            email: {
              subject: planExpirationNotification.email_subject || null,
              message: planExpirationNotification.message_email || null,
            },
          }
        : null,
      plan_cancellation_notification: planCancellationNotification
        ? {
            whatsapp: {
              worker_id: planCancellationNotification.nwr?.worker_id || null,
              name: planCancellationNotification.nwr?.name || null,
              message: planCancellationNotification.message_whatsapp || null,
            },
            email: {
              subject: planCancellationNotification.email_subject || null,
              message: planCancellationNotification.message_email || null,
            },
          }
        : null,
      created_at: twoFactorNotification?.created_at || null,
      updated_at:
        twoFactorNotification?.updated_at ||
        planNewNotification?.updated_at ||
        planRenewalNotification?.updated_at ||
        planExpirationNotification?.updated_at ||
        planCancellationNotification?.updated_at ||
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
        message_whatsapp: true,
        message_email: true,
        email_subject: true,
        created_at: true,
        updated_at: true,
      },
    });
  }
}
