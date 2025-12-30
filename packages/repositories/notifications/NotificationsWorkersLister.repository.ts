import * as schema from '@core/models';
import { worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';

@injectable()
export class NotificationsWorkersListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listWorkersByAccount = async (
    accountId: string
  ): Promise<ListWorkersResponse> => {
    const result = await this.dbRo
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
      })
      .from(worker)
      .innerJoin(account, eq(worker.account_id, account.account_id))
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          isNull(account.deleted_at)
        )
      )
      .execute();

    return result;
  };
}
