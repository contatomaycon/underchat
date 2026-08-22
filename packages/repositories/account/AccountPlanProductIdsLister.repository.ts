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
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';

export interface AccountPlanProductIdsListOptions {
  readonly bypassIntegrationCache?: boolean;
}

@injectable()
export class AccountPlanProductIdsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  listActivePlanProductIds = async (
    accountId: string,
    options: AccountPlanProductIdsListOptions = {}
  ): Promise<string[]> => {
    const [planProducts, crossSellProducts, integrationEntitlement] =
      await Promise.all([
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
        this.planEntitlementService.getIntegrationEntitlement(accountId, {
          bypassCache: options.bypassIntegrationCache ?? false,
        }),
      ]);

    const productIds = new Set([
      ...planProducts.map((item) => item.plan_product_id),
      ...crossSellProducts.map((item) => item.plan_product_id),
    ]);

    if (integrationEntitlement.allowed) {
      productIds.add(EPlanProduct.integration);
    } else {
      productIds.delete(EPlanProduct.integration);
    }

    return Array.from(productIds);
  };
}
