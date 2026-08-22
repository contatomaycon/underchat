import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import {
  assertCurrentWhatsappRuntimeInTransaction,
  type WhatsappRuntimeDatabaseFence,
} from './WhatsappRuntimeDatabaseFence.repository';

@injectable()
export class WorkerProfileStatusExternalIdUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateExternalId = async (
    workerProfileStatusId: string,
    externalId: string,
    runtimeFence: WhatsappRuntimeDatabaseFence
  ): Promise<boolean> => {
    const workerId = runtimeFence.worker_id.trim();

    return this.dbRw.transaction(async (tx) => {
      await assertCurrentWhatsappRuntimeInTransaction(tx, runtimeFence);

      const result = await tx
        .update(workerProfileStatus)
        .set({
          external_id: externalId,
          updated_at: new Date().toISOString(),
        })
        .where(
          and(
            eq(
              workerProfileStatus.worker_profile_status_id,
              workerProfileStatusId
            ),
            eq(workerProfileStatus.worker_id, workerId),
            or(
              isNull(workerProfileStatus.external_id),
              ne(workerProfileStatus.external_id, externalId)
            )
          )
        )
        .execute();

      return (result.rowCount ?? 0) > 0;
    });
  };
}
