import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class WorkerTotalViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  totalWorkerByAccountId = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(worker)
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };
}
