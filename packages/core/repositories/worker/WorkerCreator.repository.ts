import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class WorkerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorker = async (input: ICreateWorker): Promise<string | null> => {
    const workerId = uuidv4();

    const result = await this.db
      .insert(worker)
      .values({
        worker_id: workerId,
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        server_id: input.server_id,
        account_id: input.account_id,
        name: input.name,
        container_id: input.container_id,
      })
      .execute();

    if (result?.rowCount === 0) {
      return null;
    }

    return workerId;
  };
}
