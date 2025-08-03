import { ICreateWorker } from '@core/common/interfaces/IWorkerPayload';
import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class WorkerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorker = async (input: ICreateWorker): Promise<boolean> => {
    const result = await this.db
      .insert(worker)
      .values({
        worker_id: input.worker_id,
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        server_id: input.server_id,
        account_id: input.account_id,
        name: input.name,
      })
      .execute();

    return result.rowCount === 1;
  };
}
