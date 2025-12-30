import * as schema from '@core/models';
import { workerProfileInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerProfileInfoViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerProfileInfoByWorkerId = async (
    workerId: string
  ): Promise<typeof workerProfileInfo.$inferSelect | null> => {
    const result = await this.db
      .select({
        worker_profile_info_id: workerProfileInfo.worker_profile_info_id,
        worker_id: workerProfileInfo.worker_id,
        name: workerProfileInfo.name,
        message: workerProfileInfo.message,
        photo: workerProfileInfo.photo,
        created_at: workerProfileInfo.created_at,
        updated_at: workerProfileInfo.updated_at,
      })
      .from(workerProfileInfo)
      .where(eq(workerProfileInfo.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0] || null;
  };
}
