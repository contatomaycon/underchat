import * as schema from '@core/models';
import { worker, server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IWorkerActiveByAccount } from '@core/common/interfaces/IWorkerActiveByAccount';

@injectable()
export class WorkerActiveByAccountViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerActiveByAccount = async (
    accountId: string
  ): Promise<IWorkerActiveByAccount[]> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        server_id: worker.server_id,
        account_id: worker.account_id,
      })
      .from(worker)
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .where(
        and(
          isNull(worker.deleted_at),
          eq(worker.account_id, accountId),
          eq(worker.worker_status_id, EWorkerStatus.online),
          eq(worker.worker_type_id, EWorkerType.baileys)
        )
      )
      .execute();

    return result as IWorkerActiveByAccount[];
  };
}
