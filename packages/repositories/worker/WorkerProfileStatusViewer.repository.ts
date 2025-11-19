import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerProfileStatusById = async (
    workerProfileStatusId: string
  ): Promise<{
    value: string;
    worker_profile_status_type_id: string;
  } | null> => {
    const result = await this.db
      .select({
        value: workerProfileStatus.value,
        worker_profile_status_type_id:
          workerProfileStatus.worker_profile_status_type_id,
      })
      .from(workerProfileStatus)
      .where(
        eq(workerProfileStatus.worker_profile_status_id, workerProfileStatusId)
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };
}
