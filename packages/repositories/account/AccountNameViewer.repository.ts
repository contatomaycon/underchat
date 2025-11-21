import * as schema from '@core/models';
import { account } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IViewAccountName } from '@core/common/interfaces/IViewAccountName';

@injectable()
export class AccountNameViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewAccountName = async (
    accountId: string
  ): Promise<IViewAccountName | null> => {
    const result = await this.db
      .select({
        id: account.account_id,
        name: account.name,
      })
      .from(account)
      .where(and(eq(account.account_id, accountId)))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as IViewAccountName;
  };
}
