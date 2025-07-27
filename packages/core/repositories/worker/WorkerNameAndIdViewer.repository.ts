import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';

@injectable()
export class WorkerNameAndIdViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerNameAndId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        container_id: worker.container_id,
        container_name: worker.container_name,
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerNameAndId;
  };
}
