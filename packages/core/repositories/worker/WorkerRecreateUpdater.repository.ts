import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';

@injectable()
export class WorkerRecreateUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateWorkerRecreate = async (input: IUpdateWorker): Promise<boolean> => {
    const result = await this.db
      .update(worker)
      .set({
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        container_id: input.container_id,
      })
      .where(and(eq(worker.worker_id, input.worker_id)))
      .execute();

    return result.rowCount === 1;
  };
}
