import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateWorkerById = async (
    workerId: string,
    name: string
  ): Promise<boolean> => {
    const result = await this.db
      .update(worker)
      .set({
        name,
      })
      .where(eq(worker.worker_id, workerId))
      .execute();

    return result.rowCount === 1;
  };
}
