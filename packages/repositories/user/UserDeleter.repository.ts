import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class UserDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const date = currentTime();
    const accountCondition = isAdministrator
      ? undefined
      : eq(user.account_id, accountId);

    const result = await this.db
      .update(user)
      .set({
        deleted_at: date,
      })
      .where(and(accountCondition, eq(user.user_id, userId)))
      .execute();

    return result.rowCount === 1;
  };
}
