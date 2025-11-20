import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { isNull } from 'drizzle-orm';

@injectable()
export class AccountAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAllAccounts = async (): Promise<{ account_id: string; name: string }[]> => {
    const result = await this.db.query.account.findMany({
      where: isNull(account.deleted_at),
      columns: {
        account_id: true,
        name: true,
      },
      orderBy: (account, { asc }) => [asc(account.name)],
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      account_id: item.account_id,
      name: item.name,
    }));
  };
}

