import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class UserDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteUserById = async (
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(user)
      .set({
        deleted_at: date,
      })
      .where(and(eq(user.account_id, accountId), eq(user.user_id, userId)))
      .execute();

    return result.rowCount === 1;
  };
}
