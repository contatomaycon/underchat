import * as schema from '@core/models';
import {
  planAccount,
  planCrossSell,
  planCrossSellAccount,
  planItems,
} from '@core/models';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountPlanProductIdsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listActivePlanProductIds = async (accountId: string): Promise<string[]> => {
    const [planProducts, crossSellProducts] = await Promise.all([
      this.dbRo
        .selectDistinct({
          plan_product_id: planItems.plan_product_id,
        })
        .from(planAccount)
        .innerJoin(planItems, eq(planItems.plan_id, planAccount.plan_id))
        .where(
          and(
            eq(planAccount.account_id, accountId),
            gt(planAccount.next_payment_date, sql`NOW()`),
            gt(planItems.quantity, 0),
            isNull(planItems.deleted_at)
          )
        )
        .execute(),
      this.dbRo
        .selectDistinct({
          plan_product_id: planCrossSell.plan_product_id,
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
            gt(planCrossSell.quantity, 0),
            isNull(planCrossSellAccount.deleted_at),
            isNull(planCrossSell.deleted_at)
          )
        )
        .execute(),
    ]);

    return Array.from(
      new Set([
        ...planProducts.map((item) => item.plan_product_id),
        ...crossSellProducts.map((item) => item.plan_product_id),
      ])
    );
  };
}
