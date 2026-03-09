import * as schema from '@core/models';
import { worker, workerStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { ListChannelsStatusResponse } from '@core/schema/dashboard/listChannelsStatus/response.schema';

@injectable()
export class DashboardChannelsStatusRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listChannelsStatus = async (
    accountId: string
  ): Promise<ListChannelsStatusResponse[]> => {
    const result = await this.dbRo
      .select({
        id: worker.worker_id,
        name: worker.name,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .orderBy(asc(worker.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status
        ? {
            id: item.status.id,
            name: item.status.name,
          }
        : null,
    }));
  };
}
