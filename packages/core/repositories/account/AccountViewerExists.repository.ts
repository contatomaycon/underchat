import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsAccountById = async (accountId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(account)
      .where(
        and(
          eq(account.account_id, accountId),
          eq(account.account_status_id, EAccountStatus.active),
          isNull(account.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
