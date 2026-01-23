import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListReleaseUsersResponse } from '@core/schema/release/listReleaseUsers/response.schema';

@injectable()
export class ReleaseUsersListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listReleaseUsers = async (
    accountId: string
  ): Promise<ListReleaseUsersResponse> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        name: userInfo.name,
      })
      .from(user)
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((u) => ({
      user_id: u.user_id,
      name: u.name || u.user_id,
    }));
  };
}
