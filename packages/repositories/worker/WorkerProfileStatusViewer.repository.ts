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
  ): Promise<{ url: string } | null> => {
    const result = await this.db
      .select({
        url: workerProfileStatus.url,
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
