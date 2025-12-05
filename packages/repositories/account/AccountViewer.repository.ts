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
        apc: {
          columns: {
            plan_account_id: true,
          },
          with: {
            pas: {
              columns: {
                plan_account_status_id: true,
                name: true,
              },
            },
            ppl: {
              columns: {
                plan_id: true,
                name: true,
                price: true,
                price_old: true,
              },
            },
          },
        },
      },
      columns: {
        account_id: true,
        name: true,
        created_at: true,
      },
    });

    if (!result?.length) {
      return null;
    }

    const activePlanAccount = result[0].apc?.find(
      (pa) => pa.pas?.name === 'active'
    );

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
          plan: activePlanAccount?.ppl
            ? {
                plan_id: activePlanAccount.ppl.plan_id,
                name: activePlanAccount.ppl.name,
                price: Number(activePlanAccount.ppl.price),
                price_old: Number(activePlanAccount.ppl.price_old),
              }
            : null,
          created_at: result[0].created_at,
        }
      : null;
  };
}
