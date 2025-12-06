import * as schema from '@core/models';
import { notifications, notificationType, worker } from '@core/models';
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
      const planTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan
      );
      const planExpirationTypeId = await this.findNotificationTypeIdByName(
        tx,
        ENotificationType.plan_expiration
      );

      const twoFactorNotification =
        input.two_factor_notification !== undefined ||
        input.two_factor_message !== undefined
          ? await this.upsertNotificationByType(
              tx,
              twoFactorTypeId,
              input.two_factor_notification,
              input.two_factor_message
            )
          : await this.findNotificationByType(tx, twoFactorTypeId);

      const planNotification =
        input.plan_notification !== undefined ||
        input.plan_message !== undefined
          ? await this.upsertNotificationByType(
              tx,
              planTypeId,
              input.plan_notification,
              input.plan_message
            )
          : await this.findNotificationByType(tx, planTypeId);

      const planExpirationNotification =
        input.plan_expiration_reminder !== undefined ||
        input.plan_expiration_message !== undefined
          ? await this.upsertNotificationByType(
              tx,
              planExpirationTypeId,
              input.plan_expiration_reminder,
              input.plan_expiration_message
            )
          : await this.findNotificationByType(tx, planExpirationTypeId);

      const firstNotificationId =
        twoFactorNotification?.notification_id ||
        planNotification?.notification_id ||
        planExpirationNotification?.notification_id ||
        uuidv7();

      return {
        notification_id: firstNotificationId,
        two_factor_notification: twoFactorNotification?.nwr
          ? {
              worker_id: twoFactorNotification.nwr.worker_id,
              name: twoFactorNotification.nwr.name,
              message: twoFactorNotification.message || null,
            }
          : null,
        plan_notification: planNotification?.nwr
          ? {
              worker_id: planNotification.nwr.worker_id,
              name: planNotification.nwr.name,
              message: planNotification.message || null,
            }
          : null,
        plan_expiration_reminder: planExpirationNotification?.nwr
          ? {
              worker_id: planExpirationNotification.nwr.worker_id,
              name: planExpirationNotification.nwr.name,
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
        message: true,
        created_at: true,
        updated_at: true,
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
    message: string | null | undefined
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
        message?: string | null;
        updated_at: string;
      } = {
        updated_at: new Date().toISOString(),
      };

      if (workerId !== undefined) {
        updateData.worker_id = workerId;
      }

      if (message !== undefined) {
        updateData.message = message;
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
          message: true,
          created_at: true,
          updated_at: true,
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
        message: message || null,
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
        message: true,
        created_at: true,
        updated_at: true,
      },
    });
  }
}
