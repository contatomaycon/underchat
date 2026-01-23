import * as schema from '@core/models';
import { worker, workerStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, asc } from 'drizzle-orm';
import { ListOfflineChannelsResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class DashboardOfflineChannelsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listOfflineChannels = async (
    accountId: string
  ): Promise<ListOfflineChannelsResponse[]> => {
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
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          ne(workerStatus.worker_status_id, EWorkerStatus.online)
        )
      )
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
