import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, or } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';

@injectable()
export class WorkerBaileysActivitiesListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listWorkerBaileysActivities = async (): Promise<IListWorkerActivities[]> => {
    const result = await this.db
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
          or(
            eq(worker.worker_status_id, EWorkerStatus.disponible),
            eq(worker.worker_status_id, EWorkerStatus.error),
            eq(worker.worker_status_id, EWorkerStatus.offline),
            eq(worker.worker_status_id, EWorkerStatus.online)
          ),
          eq(worker.worker_type_id, EWorkerType.baileys)
        )
      )
      .execute();

    if (!result?.length) {
      return [] as IListWorkerActivities[];
    }

    return result as IListWorkerActivities[];
  };
}
