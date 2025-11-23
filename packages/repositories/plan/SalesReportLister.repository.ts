import * as schema from '@core/models';
import { plan, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  SQLWrapper,
  or,
  ilike,
  sql,
  gte,
  lte,
  desc,
  asc,
} from 'drizzle-orm';
import { ListSalesReportRequest } from '@core/schema/plan/listSalesReport/request.schema';
import { SalesReportItem } from '@core/schema/plan/listSalesReport/response.schema';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

@injectable()
export class SalesReportListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (
    query: ListSalesReportRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.plan_id) {
      filters.push(eq(plan.plan_id, query.plan_id));
    }

    if (query.date_from) {
      filters.push(gte(account.created_at, query.date_from));
    }

    if (query.date_to) {
      filters.push(lte(account.created_at, query.date_to));
    }

    if (query.search) {
      const searchConditions: (SQLWrapper | undefined)[] = [
        ilike(plan.name, `%${query.search}%`),
        ilike(sql`CAST(${plan.price} AS TEXT)`, `%${query.search}%`),
      ];

      const filteredConditions = searchConditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    filters.push(isNull(account.deleted_at));
    filters.push(isNull(plan.deleted_at));

    return filters;
  };

  private readonly getOrderBy = (sortBy?: SortRequest[]) => {
    if (!sortBy || sortBy.length === 0) {
      return desc(sql`COUNT(${account.account_id})`);
    }

    const sort = sortBy[0];
    const isAsc = sort.order === 'asc' || sort.order === true;
    const direction = isAsc ? asc : desc;

    switch (sort.key) {
      case 'name':
        return direction(plan.name);
      case 'price':
        return direction(plan.price);
      case 'sold_count':
        return direction(sql`COUNT(${account.account_id})`);
      case 'total_revenue':
        return direction(sql`SUM(${plan.price})`);
      case 'created_at':
        return direction(plan.created_at);
      default:
        return desc(sql`COUNT(${account.account_id})`);
    }
  };

  listSalesReport = async (
    perPage: number,
    currentPage: number,
    query: ListSalesReportRequest
  ): Promise<SalesReportItem[]> => {
    const filters = this.setFilters(query);
    const orderBy = this.getOrderBy(query.sort_by);

    const result = await this.db
      .select({
        plan_id: plan.plan_id,
        name: plan.name,
        price: plan.price,
        price_old: plan.price_old,
        sold_count: sql<number>`COUNT(${account.account_id})::int`.as(
          'sold_count'
        ),
        total_revenue: sql<string>`SUM(${plan.price})::text`.as(
          'total_revenue'
        ),
        created_at: plan.created_at,
      })
      .from(plan)
      .innerJoin(account, eq(account.plan_id, plan.plan_id))
      .where(and(...filters))
      .groupBy(
        plan.plan_id,
        plan.name,
        plan.price,
        plan.price_old,
        plan.created_at
      )
      .orderBy(orderBy)
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result.length) {
      return [] as SalesReportItem[];
    }

    const sales: SalesReportItem[] = result.map((item) => ({
      plan_id: item.plan_id,
      name: item.name,
      price: item.price,
      price_old: item.price_old,
      sold_count: item.sold_count,
      total_revenue: item.total_revenue,
      created_at: item.created_at ?? '',
    }));

    return sales;
  };

  listSalesReportTotal = async (
    query: ListSalesReportRequest
  ): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.db
      .select({
        count: sql<number>`COUNT(DISTINCT ${plan.plan_id})::int`.as('count'),
      })
      .from(plan)
      .innerJoin(account, eq(account.plan_id, plan.plan_id))
      .where(and(...filters))
      .groupBy(plan.plan_id)
      .execute();

    return result.length;
  };
}
