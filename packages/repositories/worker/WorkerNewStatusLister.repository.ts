import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';

@injectable()
export class WorkerNewStatusListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listWorkerNewStatus = async (): Promise<IListWorkerActivities[]> => {
    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        server_id: worker.server_id,
        account_id: worker.account_id,
        worker_status_id: worker.worker_status_id,
        number: worker.number,
        connection_date: worker.connection_date,
      })
      .from(worker)
      .where(
        and(
          isNull(worker.deleted_at),
          eq(worker.worker_status_id, EWorkerStatus.new)
        )
      )
      .execute();

    if (!result?.length) {
      return [] as IListWorkerActivities[];
    }

    return result as IListWorkerActivities[];
  };
}
