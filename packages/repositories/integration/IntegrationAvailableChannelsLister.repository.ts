import * as schema from '@core/models';
import { worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ListAvailableChannelItem } from '@core/schema/integration/listAvailableChannels/response.schema';

@injectable()
export class IntegrationAvailableChannelsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listAvailableChannels = async (
    accountId: string
  ): Promise<ListAvailableChannelItem[]> => {
    const result = await this.dbRo
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(and(eq(account.account_id, accountId), isNull(worker.deleted_at)))
      .orderBy(asc(worker.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => ({
      id: item.id,
      name: item.name,
      number: item.number,
    }));
  };
}
