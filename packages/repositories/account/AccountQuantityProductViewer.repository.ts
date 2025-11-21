import * as schema from '@core/models';
import {
  account,
  planItems,
  planCrossSellAccount,
  planCrossSell,
} from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountQuantityProductViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewPlanQuantity = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const planResult = await this.db
      .select({
        quantity: planItems.quantity,
      })
      .from(account)
      .innerJoin(planItems, eq(planItems.plan_id, account.plan_id))
      .where(
        and(
          eq(account.account_id, accountId),
          eq(planItems.plan_product_id, planProductId),
          isNull(account.deleted_at)
        )
      )
      .execute();

    if (!planResult?.length) {
      return 0;
    }

    return planResult[0].quantity;
  };

  viewPlanCrossSellQuantity = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const planCrossSellResult = await this.db
      .select({
        quantity: planCrossSell.quantity,
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSell.plan_cross_sell_id,
          planCrossSellAccount.plan_cross_sell_id
        )
      )
      .where(
        and(
          eq(planCrossSellAccount.account_id, accountId),
          eq(planCrossSell.plan_product_id, planProductId),
          isNull(planCrossSellAccount.deleted_at)
        )
      )
      .execute();

    if (!planCrossSellResult?.length) {
      return 0;
    }

    return planCrossSellResult[0].quantity;
  };

  viewAccountQuantityProduct = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const [planQuantity, planCrossSellQuantity] = await Promise.all([
      this.viewPlanQuantity(accountId, planProductId),
      this.viewPlanCrossSellQuantity(accountId, planProductId),
    ]);

    return planQuantity + planCrossSellQuantity;
  };
}
