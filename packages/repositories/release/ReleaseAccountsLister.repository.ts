import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { isNull } from 'drizzle-orm';
import { ListReleaseAccountsResponse } from '@core/schema/release/listReleaseAccounts/response.schema';

@injectable()
export class ReleaseAccountsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listReleaseAccounts = async (): Promise<ListReleaseAccountsResponse> => {
    const result = await this.dbRo.query.account.findMany({
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
