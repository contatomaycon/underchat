import * as schema from '@core/models';
import { plan } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  isNull,
  SQLWrapper,
  or,
  ilike,
  sql,
} from 'drizzle-orm';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { ListPlanResponse } from '@core/schema/plan/listPlan/response.schema';

@injectable()
export class PlanListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersPlan = (query: ListPlanRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.price) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(plan.name, `%${query.name}%`) : undefined,
        query.price
          ? ilike(sql`CAST(${plan.price} AS TEXT)`, `%${query.price}%`)
          : undefined,
      ];

      const filteredConditions = conditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    if (query.plan_id) {
      filters.push(eq(plan.plan_id, query.plan_id));
    }

    return filters;
  };

  listPlans = async (
    perPage: number,
    currentPage: number,
    query: ListPlanRequest
  ): Promise<ListPlanResponse[]> => {
    const filtersPlan = this.setFiltersPlan(query);

    const result = await this.db
      .select({
        plan_id: plan.plan_id,
        name: plan.name,
        price: plan.price,
        price_old: plan.price_old,
        description: plan.description,
        annual_discount: plan.annual_discount,
        icon: plan.icon,
        created_at: plan.created_at,
      })
      .from(plan)
      .where(and(...filtersPlan, isNull(plan.deleted_at)))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result.length) {
      return [] as ListPlanResponse[];
    }

    const plans: ListPlanResponse[] = result.map((item) => ({
      plan_id: item.plan_id,
      name: item.name,
      price: Number(item.price),
      price_old: Number(item.price_old),
      description: item.description ?? null,
      annual_discount: item.annual_discount ?? null,
      icon: item.icon ?? null,
      created_at: item.created_at,
    }));

    return plans;
  };

  listPlansTotal = async (query: ListPlanRequest): Promise<number> => {
    const filtersPlan = this.setFiltersPlan(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(plan)
      .where(and(...filtersPlan, isNull(plan.deleted_at)))
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };
}
