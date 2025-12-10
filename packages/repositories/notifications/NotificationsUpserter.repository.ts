import * as schema from '@core/models';
import { notifications, notificationType } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations, eq, isNull, and } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';
import { ENotificationType } from '@core/common/enums/ENotificationType';

@injectable()
export class NotificationsUpserterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertNotifications = async (
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> => {
    return this.db.transaction(async (tx) => {
      const twoFactorTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.two_factor
      );
      const planNewTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan_new
      );
      const planRenewalTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan_renewal
      );
      const planExpirationTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan_expiration
      );

      const twoFactorNotification =
        input.two_factor_notification !== undefined ||
        input.two_factor_message_whatsapp !== undefined ||
        input.two_factor_message_email !== undefined ||
        input.two_factor_email_subject !== undefined
          ? await this.upsertNotificationByType(
              tx,
              twoFactorTypeId,
              input.two_factor_notification,
              input.two_factor_message_whatsapp,
              input.two_factor_message_email,
              input.two_factor_email_subject
            )
          : await this.findNotificationByType(tx, twoFactorTypeId);

      const planNewNotification =
        input.plan_new_notification !== undefined ||
        input.plan_new_message_whatsapp !== undefined ||
        input.plan_new_message_email !== undefined ||
        input.plan_new_email_subject !== undefined
          ? await this.upsertNotificationByType(
              tx,
              planNewTypeId,
              input.plan_new_notification,
              input.plan_new_message_whatsapp,
              input.plan_new_message_email,
              input.plan_new_email_subject
            )
          : await this.findNotificationByType(tx, planNewTypeId);

      const planRenewalNotification =
        input.plan_renewal_notification !== undefined ||
        input.plan_renewal_message_whatsapp !== undefined ||
        input.plan_renewal_message_email !== undefined ||
        input.plan_renewal_email_subject !== undefined
          ? await this.upsertNotificationByType(
              tx,
              planRenewalTypeId,
              input.plan_renewal_notification,
              input.plan_renewal_message_whatsapp,
              input.plan_renewal_message_email,
              input.plan_renewal_email_subject
            )
          : await this.findNotificationByType(tx, planRenewalTypeId);

      const planExpirationNotification =
        input.plan_expiration_reminder !== undefined ||
        input.plan_expiration_message_whatsapp !== undefined ||
        input.plan_expiration_message_email !== undefined ||
        input.plan_expiration_email_subject !== undefined
          ? await this.upsertNotificationByType(
              tx,
              planExpirationTypeId,
              input.plan_expiration_reminder,
              input.plan_expiration_message_whatsapp,
              input.plan_expiration_message_email,
              input.plan_expiration_email_subject
            )
          : await this.findNotificationByType(tx, planExpirationTypeId);

      const firstNotificationId =
        twoFactorNotification?.notification_id ||
        planNewNotification?.notification_id ||
        planRenewalNotification?.notification_id ||
        planExpirationNotification?.notification_id ||
        uuidv7();

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
        created_at: twoFactorNotification?.created_at || null,
        updated_at:
          twoFactorNotification?.updated_at ||
          planNewNotification?.updated_at ||
          planRenewalNotification?.updated_at ||
          planExpirationNotification?.updated_at ||
          null,
      };
    });
  };

  private async findNotificationTypeIdByName(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    name: string
  ): Promise<string> {
    const result = await tx
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

  private async findNotificationByType(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    notificationTypeId: string
  ) {
    return tx.query.notifications.findFirst({
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
        worker_id: true,
      },
    });
  }

  private async upsertNotificationByType(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    notificationTypeId: string,
    workerId: string | null | undefined,
    messageWhatsapp: string | null | undefined,
    messageEmail: string | null | undefined,
    emailSubject: string | null | undefined
  ) {
    const existing = await this.findNotificationByType(tx, notificationTypeId);

    if (existing) {
      if (workerId === null) {
        await tx
          .update(notifications)
          .set({ deleted_at: new Date().toISOString() })
          .where(eq(notifications.notification_id, existing.notification_id))
          .execute();
        return null;
      }

      const updateData: {
        worker_id?: string;
        message_whatsapp?: string | null;
        message_email?: string | null;
        email_subject?: string | null;
        updated_at: string;
      } = {
        updated_at: new Date().toISOString(),
      };

      if (workerId !== undefined) {
        updateData.worker_id = workerId;
      }

      if (messageWhatsapp !== undefined) {
        updateData.message_whatsapp = messageWhatsapp;
      }

      if (messageEmail !== undefined) {
        updateData.message_email = messageEmail;
      }

      if (emailSubject !== undefined) {
        updateData.email_subject = emailSubject;
      }

      await tx
        .update(notifications)
        .set(updateData)
        .where(eq(notifications.notification_id, existing.notification_id))
        .execute();

      return tx.query.notifications.findFirst({
        where: eq(notifications.notification_id, existing.notification_id),
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
          worker_id: true,
        },
      });
    }

    if (workerId === null || workerId === undefined) {
      return null;
    }

    const notificationId = uuidv7();

    await tx
      .insert(notifications)
      .values({
        notification_id: notificationId,
        notification_type_id: notificationTypeId,
        worker_id: workerId,
        message_whatsapp: messageWhatsapp || null,
        message_email: messageEmail || null,
        email_subject: emailSubject || null,
      })
      .execute();

    return tx.query.notifications.findFirst({
      where: eq(notifications.notification_id, notificationId),
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
        worker_id: true,
      },
    });
  }
}
