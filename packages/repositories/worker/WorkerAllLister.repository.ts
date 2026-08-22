import * as schema from '@core/models';
import {
  worker,
  workerRuntime,
  workerStatus,
  account,
  whatsappSessionLease,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  effectiveWorkerOnlinePredicate,
  liveWhatsappSessionLeaseJoinCondition,
} from './workerEffectiveOnline.sql';

@injectable()
export class WorkerAllListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listAllWorkers = async (accountId: string): Promise<TransferWorker[]> => {
    const result = await this.dbRo
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
        type_id: worker.worker_type_id,
        is_official: eq(worker.worker_type_id, EWorkerType.whatsapp),
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
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(whatsappSessionLease, liveWhatsappSessionLeaseJoinCondition())
      .where(
        and(
          eq(account.account_id, accountId),
          isNull(worker.deleted_at),
          effectiveWorkerOnlinePredicate()
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
