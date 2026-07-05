import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

@injectable()
export class WorkerMonitorViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listWorkers = async (): Promise<IWorkerMonitor[]> => {
    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .where(
        and(
          isNull(worker.deleted_at),
          isNotNull(worker.server_id),
          ne(worker.worker_status_id, EWorkerStatus.stopped),
          ne(worker.worker_type_id, EWorkerType.whatsapp)
        )
      )
      .orderBy(sql`CASE WHEN ${worker.updated_at} IS NULL THEN 0 ELSE 1 END`)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as IWorkerMonitor[];
  };

  viewWorker = async (workerId: string): Promise<IWorkerMonitor | null> => {
    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .where(
        and(
          eq(worker.worker_id, workerId),
          isNotNull(worker.server_id),
          ne(worker.worker_type_id, EWorkerType.whatsapp)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IWorkerMonitor;
  };
}
