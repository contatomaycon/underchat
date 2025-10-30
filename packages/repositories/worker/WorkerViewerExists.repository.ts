import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class WorkerViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsWorkerById = async (
    isAdministrator: boolean,
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(worker.account_id, accountId);

    const result = await this.db
      .select({
        total: count(),
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

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
