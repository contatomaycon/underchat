import * as schema from '@core/models';
import { userChannel, worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class UserChannelChannelsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listChannelIdsByUserAndAccount = async (
    userId: string,
    accountId: string
  ): Promise<string[]> => {
    const result = await this.dbRo
      .select({
        channel_id: userChannel.channel_id,
      })
      .from(userChannel)
      .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
      .innerJoin(account, eq(userChannel.account_id, account.account_id))
      .where(
        and(
          eq(userChannel.user_id, userId),
          eq(userChannel.account_id, accountId)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.channel_id);
  };
}
