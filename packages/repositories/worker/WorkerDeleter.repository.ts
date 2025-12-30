import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WorkerDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(worker)
      .set({
        deleted_at: date,
      })
      .where(
        and(eq(worker.account_id, accountId), eq(worker.worker_id, workerId))
      )
      .execute();

    return result.rowCount === 1;
  };
}
