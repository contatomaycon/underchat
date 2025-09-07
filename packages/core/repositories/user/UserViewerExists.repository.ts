import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class UserViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(user.account_id, accountId);

    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(
        and(accountCondition, eq(user.user_id, userId), isNull(user.deleted_at))
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
