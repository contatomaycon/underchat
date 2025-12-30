import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusExternalIdUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateExternalId = async (
    workerProfileStatusId: string,
    externalId: string
  ): Promise<boolean> => {
    const result = await this.db
      .update(workerProfileStatus)
      .set({
        external_id: externalId,
        updated_at: new Date().toISOString(),
      })
      .where(
        eq(workerProfileStatus.worker_profile_status_id, workerProfileStatusId)
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
