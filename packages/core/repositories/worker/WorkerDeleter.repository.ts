import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WorkerDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteWorkerById = async (
    isAdministrator: boolean,
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(worker.account_id, accountId);

    const date = currentTime();

    const result = await this.db
      .update(worker)
      .set({
        deleted_at: date,
      })
      .where(and(eq(worker.worker_id, workerId), accountCondition))
      .execute();

    return result.rowCount === 1;
  };
}
