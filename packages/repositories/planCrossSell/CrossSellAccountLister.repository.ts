import * as schema from '@core/models';
import { planCrossSellAccount, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, isNull, and } from 'drizzle-orm';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';

@injectable()
export class CrossSellAccountListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listCrossSellAccounts = async (
    crossSellId: string
  ): Promise<ListCrossSellAccountResponse[]> => {
    const result = await this.db
      .select({
        plan_cross_sell_account_id:
          planCrossSellAccount.plan_cross_sell_account_id,
        plan_cross_sell_id: planCrossSellAccount.plan_cross_sell_id,
        account_id: planCrossSellAccount.account_id,
        created_at: planCrossSellAccount.created_at,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
      })
      .from(planCrossSellAccount)
      .leftJoin(
        account,
        eq(planCrossSellAccount.account_id, account.account_id)
      )
      .where(
        and(
          eq(planCrossSellAccount.plan_cross_sell_id, crossSellId),
          isNull(planCrossSellAccount.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return [] as ListCrossSellAccountResponse[];
    }

    const accounts: ListCrossSellAccountResponse[] = result.map((item) => ({
      plan_cross_sell_account_id: item.plan_cross_sell_account_id,
      plan_cross_sell_id: item.plan_cross_sell_id,
      account_id: item.account_id,
      created_at: item.created_at,
      account:
        item.account?.account_id && item.account.name
          ? {
              account_id: item.account.account_id,
              name: item.account.name,
            }
          : undefined,
    }));

    return accounts;
  };
}
