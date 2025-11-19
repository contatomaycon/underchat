import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteWorkerProfileStatus = async (
    workerProfileStatusId: string
  ): Promise<boolean> => {
    const result = await this.db
      .delete(workerProfileStatus)
      .where(
        eq(workerProfileStatus.worker_profile_status_id, workerProfileStatusId)
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
