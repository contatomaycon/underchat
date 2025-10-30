import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewAccountResponse } from '@core/schema/account/viewAccount/response.schema';

@injectable()
export class AccountViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewAccounts = async (
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewAccountResponse | null> => {
    const result = await this.db.query.account.findMany({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        aac: {
          columns: {
            account_status_id: true,
            name: true,
          },
        },
        apl: {
          columns: {
            plan_id: true,
            name: true,
            price: true,
            price_old: true,
          },
        },
      },
      columns: {
        account_id: true,
        name: true,
        created_at: true,
      },
    });

    if (!result) {
      return null;
    }

    return isAdministrator
      ? {
          account_id: result[0].account_id,
          name: result[0].name,
          account_status: result[0].aac
            ? {
                account_status_id: result[0].aac.account_status_id,
                name: result[0].aac.name,
              }
            : null,
          plan: result[0].apl
            ? {
                plan_id: result[0].apl.plan_id,
                name: result[0].apl.name,
                price: Number(result[0].apl.price),
                price_old: Number(result[0].apl.price_old),
              }
            : null,
          created_at: result[0].created_at,
        }
      : null;
  };
}
