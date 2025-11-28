import * as schema from '@core/models';
import {
  account,
  plan,
  planCrossSellAccount,
  planCrossSell,
  planProduct,
  planProductDescription,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  gte,
  lte,
  sql,
  SQLWrapper,
  inArray,
} from 'drizzle-orm';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesResponse } from '@core/schema/plan/listPlanSales/response.schema';

@injectable()
export class PlanSalesListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (query: ListPlanSalesRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.plan_id) {
      filters.push(eq(account.plan_id, query.plan_id));
    }

    if (query.start_date) {
      filters.push(gte(account.created_at, query.start_date));
    }

    if (query.end_date) {
      filters.push(lte(account.created_at, query.end_date));
    }

    return filters;
  };

  listPlanSales = async (
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesResponse[]> => {
    const filters = this.setFilters(query);

    const planSalesResult = await this.db
      .select({
        plan_id: plan.plan_id,
        plan_name: plan.name,
        price: plan.price,
        price_old: plan.price_old,
        quantity_sold: sql<number>`COUNT(DISTINCT ${account.account_id})::int`,
        total_revenue: sql<string>`(COUNT(DISTINCT ${account.account_id}) * ${plan.price})::text`,
        created_at: sql<string>`MIN(${account.created_at})::text`,
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(isNull(account.deleted_at), isNull(plan.deleted_at), ...filters)
      )
      .groupBy(plan.plan_id, plan.name, plan.price, plan.price_old)
      .execute();

    let filteredResults = planSalesResult;

    if (!filteredResults.length) {
      return [];
    }

    const results: ListPlanSalesResponse[] = [];

    for (const planSale of filteredResults) {
      const accountsForPlan = await this.db
        .select({
          account_id: account.account_id,
        })
        .from(account)
        .where(
          and(
            eq(account.plan_id, planSale.plan_id),
            isNull(account.deleted_at),
            ...filters
          )
        )
        .execute();

      const accountIds = accountsForPlan.map((a) => a.account_id);

      const crossSellsResult = accountIds.length
        ? await this.db
            .select({
              plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
              plan_product_name: planProductDescription.name,
              total_price: sql<string>`SUM(${planCrossSell.price})::text`,
              quantity: sql<number>`COUNT(DISTINCT ${planCrossSellAccount.account_id})::int`,
              cross_sell_quantity: planCrossSell.quantity,
            })
            .from(planCrossSellAccount)
            .innerJoin(
              planCrossSell,
              eq(
                planCrossSellAccount.plan_cross_sell_id,
                planCrossSell.plan_cross_sell_id
              )
            )
            .innerJoin(
              planProduct,
              eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
            )
            .innerJoin(
              planProductDescription,
              eq(
                planProduct.plan_product_id,
                planProductDescription.plan_product_id
              )
            )
            .where(
              and(
                inArray(planCrossSellAccount.account_id, accountIds),
                isNull(planCrossSellAccount.deleted_at),
                isNull(planCrossSell.deleted_at)
              )
            )
            .groupBy(
              planCrossSell.plan_cross_sell_id,
              planProductDescription.name,
              planCrossSell.quantity
            )
            .execute()
        : [];

      const planRevenue = Number(planSale.total_revenue);
      const crossSellsTotal = crossSellsResult.reduce(
        (sum, cs) => sum + Number(cs.total_price),
        0
      );
      const totalRevenue = (planRevenue + crossSellsTotal).toString();

      results.push({
        plan_id: planSale.plan_id,
        plan_name: planSale.plan_name,
        price: planSale.price,
        price_old: planSale.price_old,
        quantity_sold: planSale.quantity_sold,
        total_revenue: totalRevenue,
        cross_sells: crossSellsResult.map((cs) => ({
          plan_cross_sell_id: cs.plan_cross_sell_id,
          plan_product_name: cs.plan_product_name ?? null,
          total_price: cs.total_price,
          quantity: cs.quantity,
          cross_sell_quantity: cs.cross_sell_quantity,
        })),
        created_at: planSale.created_at ?? null,
      });
    }

    return results;
  };
}
