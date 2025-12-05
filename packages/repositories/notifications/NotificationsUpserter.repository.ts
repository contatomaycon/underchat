import * as schema from '@core/models';
import { notifications } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations, eq, isNull } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';

@injectable()
export class NotificationsUpserterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertNotifications = async (
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> => {
    return this.db.transaction(async (tx) => {
      await this.ensureSingleNotification(tx);

      const existing = await this.findExistingNotification(tx);

      if (existing) {
        return this.updateNotificationTx(tx, existing.notification_id, input);
      }

      return this.createNotificationTx(tx, input);
    });
  };

  private async ensureSingleNotification(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<void> {
    const existingNotifications = await tx
      .select({ notification_id: notifications.notification_id })
      .from(notifications)
      .where(isNull(notifications.deleted_at))
      .execute();

    if (existingNotifications.length <= 1) {
      return;
    }

    const notificationsToDelete = existingNotifications.slice(1);
    for (const notification of notificationsToDelete) {
      await tx
        .update(notifications)
        .set({ deleted_at: new Date().toISOString() })
        .where(eq(notifications.notification_id, notification.notification_id))
        .execute();
    }
  }

  private async findExistingNotification(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<{
    notification_id: string;
    two_factor_notification: string | null;
    plan_notification: string | null;
    plan_expiration_reminder: string | null;
  } | null> {
    const result = await tx
      .select({
        notification_id: notifications.notification_id,
        two_factor_notification: notifications.two_factor_notification,
        plan_notification: notifications.plan_notification,
        plan_expiration_reminder: notifications.plan_expiration_reminder,
      })
      .from(notifications)
      .where(isNull(notifications.deleted_at))
      .limit(1)
      .execute();

    return result.length > 0 ? result[0] : null;
  }

  private buildUpdateData(
    input: UpdateNotificationsRequest
  ): Partial<typeof notifications.$inferInsert> {
    const updateData: Partial<typeof notifications.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };

    if (input.two_factor_notification !== undefined) {
      updateData.two_factor_notification =
        input.two_factor_notification ?? null;
    }

    if (input.plan_notification !== undefined) {
      updateData.plan_notification = input.plan_notification ?? null;
    }

    if (input.plan_expiration_reminder !== undefined) {
      updateData.plan_expiration_reminder =
        input.plan_expiration_reminder ?? null;
    }

    return updateData;
  }

  private async updateNotificationTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    notificationId: string,
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> {
    const updateData = this.buildUpdateData(input);

    await tx
      .update(notifications)
      .set(updateData)
      .where(eq(notifications.notification_id, notificationId))
      .execute();

    const updated = await tx.query.notifications.findFirst({
      where: eq(notifications.notification_id, notificationId),
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

    if (!updated) {
      throw new Error('Failed to retrieve updated notification');
    }

    return {
      notification_id: updated.notification_id,
      two_factor_notification: updated.ntw
        ? {
            worker_id: updated.ntw.worker_id,
            name: updated.ntw.name,
          }
        : null,
      plan_notification: updated.npw
        ? {
            worker_id: updated.npw.worker_id,
            name: updated.npw.name,
          }
        : null,
      plan_expiration_reminder: updated.new
        ? {
            worker_id: updated.new.worker_id,
            name: updated.new.name,
          }
        : null,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    };
  }

  private async createNotificationTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: UpdateNotificationsRequest
  ): Promise<UpdateNotificationsResponse> {
    const notificationId = uuidv7();

    await tx
      .insert(notifications)
      .values({
        notification_id: notificationId,
        two_factor_notification: input.two_factor_notification ?? null,
        plan_notification: input.plan_notification ?? null,
        plan_expiration_reminder: input.plan_expiration_reminder ?? null,
      })
      .execute();

    const created = await tx.query.notifications.findFirst({
      where: eq(notifications.notification_id, notificationId),
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

    if (!created) {
      throw new Error('Failed to retrieve created notification');
    }

    return {
      notification_id: created.notification_id,
      two_factor_notification: created.ntw
        ? {
            worker_id: created.ntw.worker_id,
            name: created.ntw.name,
          }
        : null,
      plan_notification: created.npw
        ? {
            worker_id: created.npw.worker_id,
            name: created.npw.name,
          }
        : null,
      plan_expiration_reminder: created.new
        ? {
            worker_id: created.new.worker_id,
            name: created.new.name,
          }
        : null,
      created_at: created.created_at,
      updated_at: created.updated_at,
    };
  }
}
