import * as schema from '@core/models';
import {
  contactChannel,
  outboundWebhook,
  outboundWebhookDelivery,
  worker,
  workerWhatsappOfficialConnection,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

export interface WorkerDeletionOptions {
  lifecycleOperationId?: string;
  expectedLifecycleOperationId?: string | null;
}

@injectable()
export class WorkerDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteWorkerById = async (
    accountId: string,
    workerId: string,
    options: WorkerDeletionOptions = {}
  ): Promise<boolean> => {
    const date = currentTime();
    const workerConditions = [
      eq(worker.account_id, accountId),
      eq(worker.worker_id, workerId),
      isNull(worker.deleted_at),
    ];

    if ('expectedLifecycleOperationId' in options) {
      workerConditions.push(
        options.expectedLifecycleOperationId
          ? eq(
              worker.lifecycle_operation_id,
              options.expectedLifecycleOperationId
            )
          : isNull(worker.lifecycle_operation_id)
      );
    }
    if (options.lifecycleOperationId) {
      workerConditions.push(
        eq(worker.worker_status_id, EWorkerStatus.deleting)
      );
    }

    return this.dbRw.transaction(async (transaction) => {
      const deleted = await transaction
        .update(worker)
        .set({
          deleted_at: date,
          ...(options.lifecycleOperationId
            ? { worker_status_id: EWorkerStatus.deleting }
            : {}),
          ...(options.lifecycleOperationId
            ? { lifecycle_operation_id: options.lifecycleOperationId }
            : {}),
        })
        .where(and(...workerConditions))
        .returning({ id: worker.worker_id })
        .execute();
      if (!deleted[0]) return false;

      await transaction
        .update(workerWhatsappOfficialConnection)
        .set({
          deleted_at: date,
          updated_at: date,
        })
        .where(
          and(
            eq(workerWhatsappOfficialConnection.worker_id, workerId),
            isNull(workerWhatsappOfficialConnection.deleted_at)
          )
        )
        .execute();

      await transaction
        .delete(contactChannel)
        .where(
          and(
            eq(contactChannel.account_id, accountId),
            eq(contactChannel.channel_id, workerId)
          )
        )
        .execute();

      const disabledWebhooks = await transaction
        .update(outboundWebhook)
        .set({
          status: 'inactive',
          config_version: sql`${outboundWebhook.config_version} + 1`,
          consecutive_dead_deliveries: 0,
          suspended_at: null,
          suspension_reason: null,
          updated_at: date,
        })
        .where(
          and(
            eq(outboundWebhook.account_id, accountId),
            eq(outboundWebhook.channel_id, workerId),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .returning({ id: outboundWebhook.outbound_webhook_id })
        .execute();

      const webhookIds = disabledWebhooks.map((webhook) => webhook.id);
      if (webhookIds.length > 0) {
        await transaction
          .update(outboundWebhookDelivery)
          .set({
            status: 'suppressed',
            suppressed_at: date,
            last_error: 'channel_unavailable',
            lease_token: null,
            lease_expires_at: null,
            updated_at: date,
          })
          .where(
            and(
              inArray(outboundWebhookDelivery.outbound_webhook_id, webhookIds),
              inArray(outboundWebhookDelivery.status, ['pending', 'retrying'])
            )
          )
          .execute();
      }

      return true;
    });
  };
}
