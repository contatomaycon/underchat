import * as schema from '@core/models';
import { worker } from '@core/models';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, notInArray } from 'drizzle-orm';

@injectable()
export class WorkerTotalViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  totalWorkerByAccountId = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.blocked,
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
            EWorkerStatus.deleting,
          ])
        )
      )
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };
}
