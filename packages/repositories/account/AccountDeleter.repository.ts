import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class AccountDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteAccountById = async (accountId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(account)
      .set({
        deleted_at: date,
      })
      .where(eq(account.account_id, accountId))
      .execute();

    return result.rowCount === 1;
  };
}
