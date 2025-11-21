import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerStatusUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateStatusWorker = async (
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> => {
    const result = await this.db
      .update(worker)
      .set({
        worker_status_id: workerStatusId,
      })
      .where(and(eq(worker.worker_id, workerId)))
      .execute();

    return result.rowCount === 1;
  };
}
