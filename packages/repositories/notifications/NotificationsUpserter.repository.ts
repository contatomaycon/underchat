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
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  upsertNotifications = async (
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> => {
    return this.dbRw.transaction(async (tx) => {
      const typeIds = await this.findAllNotificationTypeIds(tx);

      const notificationConfigs = [
        {
          typeId: typeIds.twoFactor,
          hasInput:
            input.two_factor_notification !== undefined ||
            input.two_factor_message_whatsapp !== undefined ||
            input.two_factor_message_email !== undefined ||
            input.two_factor_email_subject !== undefined,
          workerId: input.two_factor_notification,
          messageWhatsapp: input.two_factor_message_whatsapp,
          messageEmail: input.two_factor_message_email,
          emailSubject: input.two_factor_email_subject,
          key: 'two_factor_notification',
        },
        {
          typeId: typeIds.planNew,
          hasInput:
            input.plan_new_notification !== undefined ||
            input.plan_new_message_whatsapp !== undefined ||
            input.plan_new_message_email !== undefined ||
            input.plan_new_email_subject !== undefined,
          workerId: input.plan_new_notification,
          messageWhatsapp: input.plan_new_message_whatsapp,
          messageEmail: input.plan_new_message_email,
          emailSubject: input.plan_new_email_subject,
          key: 'plan_new_notification',
        },
        {
          typeId: typeIds.planRenewal,
          hasInput:
            input.plan_renewal_notification !== undefined ||
            input.plan_renewal_message_whatsapp !== undefined ||
            input.plan_renewal_message_email !== undefined ||
            input.plan_renewal_email_subject !== undefined,
          workerId: input.plan_renewal_notification,
          messageWhatsapp: input.plan_renewal_message_whatsapp,
          messageEmail: input.plan_renewal_message_email,
          emailSubject: input.plan_renewal_email_subject,
          key: 'plan_renewal_notification',
        },
        {
          typeId: typeIds.planExpiration,
          hasInput:
            input.plan_expiration_reminder !== undefined ||
            input.plan_expiration_message_whatsapp !== undefined ||
            input.plan_expiration_message_email !== undefined ||
            input.plan_expiration_email_subject !== undefined,
          workerId: input.plan_expiration_reminder,
          messageWhatsapp: input.plan_expiration_message_whatsapp,
          messageEmail: input.plan_expiration_message_email,
          emailSubject: input.plan_expiration_email_subject,
          key: 'plan_expiration_reminder',
        },
        {
          typeId: typeIds.planCancellation,
          hasInput:
            input.plan_cancellation_notification !== undefined ||
            input.plan_cancellation_message_whatsapp !== undefined ||
            input.plan_cancellation_message_email !== undefined ||
            input.plan_cancellation_email_subject !== undefined,
          workerId: input.plan_cancellation_notification,
          messageWhatsapp: input.plan_cancellation_message_whatsapp,
          messageEmail: input.plan_cancellation_message_email,
          emailSubject: input.plan_cancellation_email_subject,
          key: 'plan_cancellation_notification',
        },
        {
          typeId: typeIds.recurringPaymentFailure,
          hasInput:
            input.recurring_payment_failure_notification !== undefined ||
            input.recurring_payment_failure_message_whatsapp !== undefined ||
            input.recurring_payment_failure_message_email !== undefined ||
            input.recurring_payment_failure_email_subject !== undefined,
          workerId: input.recurring_payment_failure_notification,
          messageWhatsapp: input.recurring_payment_failure_message_whatsapp,
          messageEmail: input.recurring_payment_failure_message_email,
          emailSubject: input.recurring_payment_failure_email_subject,
          key: 'recurring_payment_failure_notification',
        },
        {
          typeId: typeIds.testPlanNew,
          hasInput:
            input.test_plan_new_notification !== undefined ||
            input.test_plan_new_message_whatsapp !== undefined ||
            input.test_plan_new_message_email !== undefined ||
            input.test_plan_new_email_subject !== undefined,
          workerId: input.test_plan_new_notification,
          messageWhatsapp: input.test_plan_new_message_whatsapp,
          messageEmail: input.test_plan_new_message_email,
          emailSubject: input.test_plan_new_email_subject,
          key: 'test_plan_new_notification',
        },
        {
          typeId: typeIds.testPlanExpiration,
          hasInput:
            input.test_plan_expiration_reminder !== undefined ||
            input.test_plan_expiration_message_whatsapp !== undefined ||
            input.test_plan_expiration_message_email !== undefined ||
            input.test_plan_expiration_email_subject !== undefined,
          workerId: input.test_plan_expiration_reminder,
          messageWhatsapp: input.test_plan_expiration_message_whatsapp,
          messageEmail: input.test_plan_expiration_message_email,
          emailSubject: input.test_plan_expiration_email_subject,
          key: 'test_plan_expiration_reminder',
        },
      ];

      const processedNotifications = await Promise.all(
        notificationConfigs.map(async (config) => {
          const notification = config.hasInput
            ? await this.upsertNotificationByType(
                tx,
                config.typeId,
                config.workerId,
                config.messageWhatsapp,
                config.messageEmail,
                config.emailSubject
              )
            : await this.findNotificationByType(tx, config.typeId);

          return {
            key: config.key,
            notification,
          };
        })
      );

      const notificationsMap = new Map(
        processedNotifications.map((item) => [item.key, item.notification])
      );

      const firstNotificationId =
        notificationsMap.get('two_factor_notification')?.notification_id ||
        notificationsMap.get('plan_new_notification')?.notification_id ||
        notificationsMap.get('plan_renewal_notification')?.notification_id ||
        notificationsMap.get('plan_expiration_reminder')?.notification_id ||
        notificationsMap.get('plan_cancellation_notification')
          ?.notification_id ||
        notificationsMap.get('recurring_payment_failure_notification')
          ?.notification_id ||
        notificationsMap.get('test_plan_new_notification')?.notification_id ||
        notificationsMap.get('test_plan_expiration_reminder')
          ?.notification_id ||
        uuidv7();

      const updatedAt =
        processedNotifications
          .map((item) => item.notification?.updated_at)
          .find((date) => date) || null;

      const createdAt =
        processedNotifications
          .map((item) => item.notification?.created_at)
          .find((date) => date) || null;

      return {
        notification_id: firstNotificationId,
        two_factor_notification: this.mapNotificationToResponse(
          notificationsMap.get('two_factor_notification')
        ),
        plan_new_notification: this.mapNotificationToResponse(
          notificationsMap.get('plan_new_notification')
        ),
        plan_renewal_notification: this.mapNotificationToResponse(
          notificationsMap.get('plan_renewal_notification')
        ),
        plan_expiration_reminder: this.mapNotificationToResponse(
          notificationsMap.get('plan_expiration_reminder')
        ),
        plan_cancellation_notification: this.mapNotificationToResponse(
          notificationsMap.get('plan_cancellation_notification')
        ),
        recurring_payment_failure_notification: this.mapNotificationToResponse(
          notificationsMap.get('recurring_payment_failure_notification')
        ),
        test_plan_new_notification: this.mapNotificationToResponse(
          notificationsMap.get('test_plan_new_notification')
        ),
        test_plan_expiration_reminder: this.mapNotificationToResponse(
          notificationsMap.get('test_plan_expiration_reminder')
        ),
        created_at: createdAt,
        updated_at: updatedAt,
      };
    });
  };

  private async findAllNotificationTypeIds(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ) {
    const [
      twoFactor,
      planNew,
      planRenewal,
      planExpiration,
      planCancellation,
      recurringPaymentFailure,
      testPlanNew,
      testPlanExpiration,
    ] = await Promise.all([
      this.findNotificationTypeIdByName(tx, ENotificationType.two_factor),
      this.findNotificationTypeIdByName(tx, ENotificationType.plan_new),
      this.findNotificationTypeIdByName(tx, ENotificationType.plan_renewal),
      this.findNotificationTypeIdByName(tx, ENotificationType.plan_expiration),
      this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan_cancellation
      ),
      this.findNotificationTypeIdByName(
        tx,
        ENotificationType.recurring_payment_failure
      ),
      this.findNotificationTypeIdByName(tx, ENotificationType.test_plan_new),
      this.findNotificationTypeIdByName(
        tx,
        ENotificationType.test_plan_expiration
      ),
    ]);

    return {
      twoFactor,
      planNew,
      planRenewal,
      planExpiration,
      planCancellation,
      recurringPaymentFailure,
      testPlanNew,
      testPlanExpiration,
    };
  }

  private mapNotificationToResponse(notification: any) {
    if (!notification) {
      return null;
    }

    return {
      whatsapp: {
        worker_id: notification.nwr?.worker_id || null,
        name: notification.nwr?.name || null,
        message: notification.message_whatsapp || null,
      },
      email: {
        subject: notification.email_subject || null,
        message: notification.message_email || null,
      },
    };
  }

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
