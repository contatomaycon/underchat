import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusUpdatedAtUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateUpdatedAt = async (workerProfileStatusId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(workerProfileStatus)
      .set({
        updated_at: sql<string>`NOW()`,
      })
      .where(
        eq(workerProfileStatus.worker_profile_status_id, workerProfileStatusId)
      )
      .execute();

    return result.rowCount === 1;
  };
}
