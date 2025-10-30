import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class AccountInfoByIdViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  accountInfoByIdExists = async (accountInfoId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(accountInfo)
      .where(
        and(
          eq(accountInfo.account_info_id, accountInfoId),
          isNull(accountInfo.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
