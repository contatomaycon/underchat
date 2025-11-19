import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ICreateWorkerProfileStatus } from '@core/common/interfaces/ICreateWorkerProfileStatus';

@injectable()
export class WorkerProfileStatusCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorkerProfileStatus = async (
    input: ICreateWorkerProfileStatus
  ): Promise<string> => {
    const worker_profile_status_id = uuidv7();

    await this.db
      .insert(workerProfileStatus)
      .values({
        worker_profile_status_id,
        worker_id: input.worker_id,
        worker_profile_status_type_id: input.worker_profile_status_type_id,
        value: input.value,
        is_permanent: input.is_permanent,
      })
      .execute();

    return worker_profile_status_id;
  };
}
