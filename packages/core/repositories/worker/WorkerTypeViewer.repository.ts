import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerType } from '@core/common/interfaces/IViewWorkerType';

@injectable()
export class WorkerTypeViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerType = async (
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<IViewWorkerType | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(worker.account_id, accountId);

    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        worker_type_id: worker.worker_type_id,
      })
      .from(worker)
      .where(
        and(
          accountCondition,
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerType;
  };
}
