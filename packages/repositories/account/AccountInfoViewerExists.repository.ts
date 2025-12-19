import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class AccountInfoViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsAccountInfoById = async (accountId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(accountInfo)
      .where(
        and(
          eq(accountInfo.account_id, accountId),
          isNull(accountInfo.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };

  totalAccountInfoByAccountId = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(accountInfo)
      .where(
        and(
          eq(accountInfo.account_id, accountId),
          isNull(accountInfo.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };
}
