import * as schema from '@core/models';
import { userChannel, worker, account, user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, exists, isNull, notExists, or } from 'drizzle-orm';

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
          eq(userChannel.account_id, accountId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.channel_id);
  };

  listChannelsWithNamesByUserAndAccount = async (
    userId: string,
    accountId: string
  ): Promise<{ id: string; name: string }[]> => {
    const result = await this.dbRo
      .select({
        channel_id: userChannel.channel_id,
        name: worker.name,
      })
      .from(userChannel)
      .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
      .innerJoin(account, eq(userChannel.account_id, account.account_id))
      .where(
        and(
          eq(userChannel.user_id, userId),
          eq(userChannel.account_id, accountId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => ({
      id: item.channel_id,
      name: item.name,
    }));
  };

  private buildSubqueryUserChannelByAccount(accountId: string) {
    return this.dbRo
      .select()
      .from(userChannel)
      .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
      .where(
        and(
          eq(userChannel.user_id, user.user_id),
          eq(userChannel.account_id, accountId),
          isNull(worker.deleted_at)
        )
      );
  }

  private buildSubqueryUserChannelByAccountAndChannel(
    accountId: string,
    channelId: string
  ) {
    return this.dbRo
      .select()
      .from(userChannel)
      .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
      .where(
        and(
          eq(userChannel.user_id, user.user_id),
          eq(userChannel.account_id, accountId),
          eq(userChannel.channel_id, channelId),
          isNull(worker.deleted_at)
        )
      );
  }

  listUserIdsWithAccessToChannel = async (
    accountId: string,
    channelId: string
  ): Promise<string[]> => {
    const subqueryNoChannel = this.buildSubqueryUserChannelByAccount(accountId);
    const subqueryWithChannel =
      this.buildSubqueryUserChannelByAccountAndChannel(accountId, channelId);

    const result = await this.dbRo
      .selectDistinct({
        user_id: user.user_id,
      })
      .from(user)
      .where(
        and(
          eq(user.account_id, accountId),
          isNull(user.deleted_at),
          or(notExists(subqueryNoChannel), exists(subqueryWithChannel))
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((r) => r.user_id);
  };
}
