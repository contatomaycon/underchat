import * as schema from '@core/models';
import { worker, account } from '@core/models';
import { ListScheduleWorkersResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ScheduleWorkersListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listScheduleWorkers = async (
    accountId: string
  ): Promise<ListScheduleWorkersResponse[]> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        number: worker.number,
      })
      .from(worker)
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .orderBy(asc(worker.name))
      .execute();

    if (!result.length) {
      return [];
    }

    return result as ListScheduleWorkersResponse[];
  };
}
