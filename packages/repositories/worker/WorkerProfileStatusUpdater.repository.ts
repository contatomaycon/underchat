import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateIsPermanent = async (
    workerProfileStatusId: string,
    isPermanent: boolean
  ): Promise<boolean> => {
    const result = await this.db
      .update(workerProfileStatus)
      .set({
        is_permanent: isPermanent,
      })
      .where(
        eq(workerProfileStatus.worker_profile_status_id, workerProfileStatusId)
      )
      .execute();

    return result.rowCount === 1;
  };
}
