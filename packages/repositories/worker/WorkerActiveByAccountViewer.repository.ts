import * as schema from '@core/models';
import {
  worker,
  workerRuntime,
  server,
  whatsappSessionLease,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { IWorkerActiveByAccount } from '@core/common/interfaces/IWorkerActiveByAccount';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  effectiveWorkerOnlinePredicate,
  liveWhatsappSessionLeaseJoinCondition,
} from './workerEffectiveOnline.sql';

@injectable()
export class WorkerActiveByAccountViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerActiveByAccount = async (
    accountId: string
  ): Promise<IWorkerActiveByAccount[]> => {
    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        server_id: worker.server_id,
        account_id: worker.account_id,
      })
      .from(worker)
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(whatsappSessionLease, liveWhatsappSessionLeaseJoinCondition())
      .where(
        and(
          isNull(worker.deleted_at),
          eq(worker.account_id, accountId),
          effectiveWorkerOnlinePredicate(),
          inArray(worker.worker_type_id, [
            EWorkerType.baileys,
            EWorkerType.wwebjs,
            EWorkerType.whatsmeow,
          ])
        )
      )
      .execute();

    return result as IWorkerActiveByAccount[];
  };
}
