import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerMonitorViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listWorkers = async (): Promise<IWorkerMonitor[]> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
      })
      .from(worker)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as IWorkerMonitor[];
  };

  viewWorker = async (workerId: string): Promise<IWorkerMonitor | null> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
      })
      .from(worker)
      .where(eq(worker.worker_id, workerId))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IWorkerMonitor;
  };
}

