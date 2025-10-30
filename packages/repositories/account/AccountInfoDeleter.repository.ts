import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class AccountInfoDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteAccountInfoById = async (accountInfoId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(accountInfo)
      .set({
        deleted_at: date,
      })
      .where(eq(accountInfo.account_info_id, accountInfoId))
      .execute();

    return result.rowCount === 1;
  };
}
