import * as schema from '@core/models';
import { worker, workerStatus, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAllWorkers = async (accountId: string): Promise<TransferWorker[]> => {
    const result = await this.db
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
        status: {
          id: workerStatus.worker_status_id,
        },
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(
        and(
          eq(account.account_id, accountId),
          isNull(worker.deleted_at),
          eq(workerStatus.worker_status_id, EWorkerStatus.online)
        )
      )
      .orderBy(asc(worker.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as TransferWorker[];
  };
}
