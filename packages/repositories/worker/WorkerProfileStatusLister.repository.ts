import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ProfileStatusPhoto } from '@core/schema/worker/listProfileStatusPhotos/response.schema';

@injectable()
export class WorkerProfileStatusListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listWorkerProfileStatus = async (
    workerId: string
  ): Promise<ProfileStatusPhoto[]> => {
    const results = await this.db
      .select({
        worker_profile_status_id: workerProfileStatus.worker_profile_status_id,
        worker_id: workerProfileStatus.worker_id,
        url: workerProfileStatus.url,
        is_permanent: workerProfileStatus.is_permanent,
        created_at: workerProfileStatus.created_at,
      })
      .from(workerProfileStatus)
      .where(eq(workerProfileStatus.worker_id, workerId))
      .execute();

    if (!results?.length) {
      return [] as ProfileStatusPhoto[];
    }

    return results as ProfileStatusPhoto[];
  };
}
