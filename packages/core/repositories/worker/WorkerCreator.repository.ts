import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class WorkerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorker = async (input: ICreateWorker): Promise<number | null> => {
    const result = await this.db
      .insert(worker)
      .values({
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        server_id: input.server_id,
        account_id: input.account_id,
        name: input.name,
        container_id: input.container_id,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return result[0].worker_id;
  };
}
