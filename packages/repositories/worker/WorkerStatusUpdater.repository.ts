import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WorkerStatusUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateStatusWorker = async (
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> => {
    const updateData: Partial<typeof worker.$inferInsert> = {
      worker_status_id: workerStatusId,
      updated_at: currentTime(),
    };

    if (workerStatusId === EWorkerStatus.online) {
      updateData.last_connection_check_at = currentTime();
    }

    const result = await this.dbRw
      .update(worker)
      .set(updateData)
      .where(and(eq(worker.worker_id, workerId)))
      .execute();

    return result.rowCount === 1;
  };
}
