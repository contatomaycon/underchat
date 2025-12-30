import * as schema from '@core/models';
import { worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, count } from 'drizzle-orm';
import { IStatusCount } from '@core/common/interfaces/IStatusCount';

@injectable()
export class ChannelsStatisticsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getChannelsStatistics = async (): Promise<{
    statusCounts: IStatusCount[];
    total: number;
  }> => {
    const [statusCounts, totalCount] = await Promise.all([
      this.getStatusCounts(),
      this.getTotalCount(),
    ]);

    return {
      statusCounts,
      total: totalCount,
    };
  };

  private readonly getStatusCounts = async (): Promise<IStatusCount[]> => {
    const result = await this.dbRo
      .select({
        status_id: worker.worker_status_id,
        count: count(),
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(and(isNull(worker.deleted_at), isNull(account.deleted_at)))
      .groupBy(worker.worker_status_id)
      .execute();

    return result.map((item) => ({
      status_id: item.status_id,
      count: item.count,
    }));
  };

  private readonly getTotalCount = async (): Promise<number> => {
    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(and(isNull(worker.deleted_at), isNull(account.deleted_at)))
      .execute();

    return result[0]?.count ?? 0;
  };
}
