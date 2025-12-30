import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { desc, eq } from 'drizzle-orm';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';

@injectable()
export class WorkerProfileStatusListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listWorkerProfileStatus = async (
    workerId: string
  ): Promise<ProfileStatus[]> => {
    const results = await this.db
      .select({
        worker_profile_status_id: workerProfileStatus.worker_profile_status_id,
        worker_id: workerProfileStatus.worker_id,
        worker_profile_status_type_id:
          workerProfileStatus.worker_profile_status_type_id,
        value: workerProfileStatus.value,
        is_permanent: workerProfileStatus.is_permanent,
        mimetype: workerProfileStatus.mimetype,
        duration: workerProfileStatus.duration,
        width: workerProfileStatus.width,
        height: workerProfileStatus.height,
        created_at: workerProfileStatus.created_at,
      })
      .from(workerProfileStatus)
      .where(eq(workerProfileStatus.worker_id, workerId))
      .orderBy(desc(workerProfileStatus.created_at))
      .execute();

    if (!results?.length) {
      return [] as ProfileStatus[];
    }

    return results as ProfileStatus[];
  };
}
