import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, ne, isNull } from 'drizzle-orm';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';

@injectable()
export class AccountMasterAccessibleListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listMasterAccessibleAccounts = async (
    excludeAccountId: string
  ): Promise<IAccountBasic[]> => {
    const result = await this.dbRo
      .select({
        account_id: account.account_id,
        name: account.name,
      })
      .from(account)
      .where(
        and(
          ne(account.account_id, excludeAccountId),
          isNull(account.deleted_at)
        )
      )
      .orderBy(account.name)
      .execute();

    if (!result.length) {
      return [];
    }

    return result.map((item) => ({
      account_id: item.account_id,
      name: item.name,
    }));
  };
}
