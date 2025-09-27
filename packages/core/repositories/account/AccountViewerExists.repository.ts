import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

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
      .where(and(eq(account.account_id, accountId), isNull(account.deleted_at)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
