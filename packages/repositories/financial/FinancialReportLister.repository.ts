import * as schema from '@core/models';
import {
  account,
  plan,
  planCrossSellAccount,
  planCrossSell,
  expenditure,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, sql, isNull, gte, lte, eq } from 'drizzle-orm';
import { ListFinancialReportRequest } from '@core/schema/financial/listFinancialReport/request.schema';
import {
  FinancialReportItem,
  FinancialReportAnnual,
} from '@core/schema/financial/listFinancialReport/response.schema';

@injectable()
export class FinancialReportListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private getAccountDateFilters(
    query: ListFinancialReportRequest
  ): Array<ReturnType<typeof gte> | ReturnType<typeof lte>> {
    const filters: Array<ReturnType<typeof gte> | ReturnType<typeof lte>> = [];

    if (query.date_from) {
      filters.push(gte(account.created_at, query.date_from));
    }

    if (query.date_to) {
      filters.push(lte(account.created_at, query.date_to));
    }

    return filters;
  }

  private getCrossSellDateFilters(
    query: ListFinancialReportRequest
  ): Array<ReturnType<typeof gte> | ReturnType<typeof lte>> {
    const filters: Array<ReturnType<typeof gte> | ReturnType<typeof lte>> = [];

    if (query.date_from) {
      filters.push(gte(planCrossSellAccount.created_at, query.date_from));
    }

    if (query.date_to) {
      filters.push(lte(planCrossSellAccount.created_at, query.date_to));
    }

    return filters;
  }

  private getExpenditureDateFilters(
    query: ListFinancialReportRequest
  ): Array<ReturnType<typeof gte> | ReturnType<typeof lte>> {
    const filters: Array<ReturnType<typeof gte> | ReturnType<typeof lte>> = [];

    if (query.date_from) {
      filters.push(gte(expenditure.created_at, query.date_from));
    }

    if (query.date_to) {
      filters.push(lte(expenditure.created_at, query.date_to));
    }

    return filters;
  }

  async getAnnualReport(
    query: ListFinancialReportRequest
  ): Promise<FinancialReportAnnual> {
    const accountDateFilters = this.getAccountDateFilters(query);
    const crossSellDateFilters = this.getCrossSellDateFilters(query);
    const expenditureDateFilters = this.getExpenditureDateFilters(query);

    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01T00:00:00Z`;
    const yearEnd = `${currentYear}-12-31T23:59:59Z`;

    const planRevenueResult = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${plan.price})::text, '0')`.as('total'),
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(
          isNull(account.deleted_at),
          isNull(plan.deleted_at),
          gte(account.created_at, yearStart),
          lte(account.created_at, yearEnd),
          ...accountDateFilters
        )
      )
      .execute();

    const crossSellRevenueResult = await this.db
      .select({
        total:
          sql<string>`COALESCE(SUM((${planCrossSell.price} * ${planCrossSell.quantity})::numeric)::text, '0')`.as(
            'total'
          ),
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSellAccount.plan_cross_sell_id,
          planCrossSell.plan_cross_sell_id
        )
      )
      .where(
        and(
          isNull(planCrossSellAccount.deleted_at),
          isNull(planCrossSell.deleted_at),
          gte(planCrossSellAccount.created_at, yearStart),
          lte(planCrossSellAccount.created_at, yearEnd),
          ...crossSellDateFilters
        )
      )
      .execute();

    const expenseResult = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${expenditure.price})::text, '0')`.as(
          'total'
        ),
      })
      .from(expenditure)
      .where(
        and(
          isNull(expenditure.deleted_at),
          gte(expenditure.created_at, yearStart),
          lte(expenditure.created_at, yearEnd),
          ...expenditureDateFilters
        )
      )
      .execute();

    const planRevenue = parseFloat(planRevenueResult[0]?.total || '0');
    const crossSellRevenue = parseFloat(
      crossSellRevenueResult[0]?.total || '0'
    );
    const totalIncome = planRevenue + crossSellRevenue;
    const totalExpense = parseFloat(expenseResult[0]?.total || '0');
    const net = totalIncome - totalExpense;

    const monthlyBreakdown = await this.getMonthlyBreakdown(query);

    return {
      annual_income: totalIncome.toFixed(2),
      annual_expense: totalExpense.toFixed(2),
      annual_net: net.toFixed(2),
      monthly_breakdown: monthlyBreakdown,
    };
  }

  async getMonthlyBreakdown(
    query: ListFinancialReportRequest
  ): Promise<FinancialReportItem[]> {
    const accountDateFilters = this.getAccountDateFilters(query);
    const crossSellDateFilters = this.getCrossSellDateFilters(query);
    const expenditureDateFilters = this.getExpenditureDateFilters(query);

    const currentYear = new Date().getFullYear();

    const planRevenueByMonth = await this.db
      .select({
        month: sql<string>`TO_CHAR(${account.created_at}, 'YYYY-MM')`.as(
          'month'
        ),
        total: sql<string>`COALESCE(SUM(${plan.price})::text, '0')`.as('total'),
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(
          isNull(account.deleted_at),
          isNull(plan.deleted_at),
          sql`EXTRACT(YEAR FROM ${account.created_at}) = ${currentYear}`,
          ...accountDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${account.created_at}, 'YYYY-MM')`)
      .execute();

    const crossSellRevenueByMonth = await this.db
      .select({
        month:
          sql<string>`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM')`.as(
            'month'
          ),
        total:
          sql<string>`COALESCE(SUM((${planCrossSell.price} * ${planCrossSell.quantity})::numeric)::text, '0')`.as(
            'total'
          ),
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSellAccount.plan_cross_sell_id,
          planCrossSell.plan_cross_sell_id
        )
      )
      .where(
        and(
          isNull(planCrossSellAccount.deleted_at),
          isNull(planCrossSell.deleted_at),
          sql`EXTRACT(YEAR FROM ${planCrossSellAccount.created_at}) = ${currentYear}`,
          ...crossSellDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM')`)
      .execute();

    const expenseByMonth = await this.db
      .select({
        month: sql<string>`TO_CHAR(${expenditure.created_at}, 'YYYY-MM')`.as(
          'month'
        ),
        total: sql<string>`COALESCE(SUM(${expenditure.price})::text, '0')`.as(
          'total'
        ),
      })
      .from(expenditure)
      .where(
        and(
          isNull(expenditure.deleted_at),
          sql`EXTRACT(YEAR FROM ${expenditure.created_at}) = ${currentYear}`,
          ...expenditureDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${expenditure.created_at}, 'YYYY-MM')`)
      .execute();

    const monthMap = new Map<string, { income: number; expense: number }>();

    planRevenueByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    crossSellRevenueByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    expenseByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income,
        expense: existing.expense + parseFloat(item.total || '0'),
      });
    });

    const monthNames: Record<string, string> = {
      '01': 'Janeiro',
      '02': 'Fevereiro',
      '03': 'Março',
      '04': 'Abril',
      '05': 'Maio',
      '06': 'Junho',
      '07': 'Julho',
      '08': 'Agosto',
      '09': 'Setembro',
      '10': 'Outubro',
      '11': 'Novembro',
      '12': 'Dezembro',
    };

    const result: FinancialReportItem[] = Array.from(monthMap.entries())
      .map(([month, data]) => {
        const monthNumber = month.split('-')[1];
        return {
          month: monthNames[monthNumber] || month,
          income: data.income.toFixed(2),
          expense: data.expense.toFixed(2),
          net: (data.income - data.expense).toFixed(2),
        };
      })
      .sort((a, b) => {
        const monthA = Object.keys(monthNames).indexOf(
          Object.keys(monthNames).find((k) => monthNames[k] === a.month) || ''
        );
        const monthB = Object.keys(monthNames).indexOf(
          Object.keys(monthNames).find((k) => monthNames[k] === b.month) || ''
        );
        return monthA - monthB;
      });

    return result;
  }

  async getMonthlyReport(
    query: ListFinancialReportRequest
  ): Promise<FinancialReportItem[]> {
    const accountDateFilters = this.getAccountDateFilters(query);
    const crossSellDateFilters = this.getCrossSellDateFilters(query);
    const expenditureDateFilters = this.getExpenditureDateFilters(query);

    const planRevenueByMonth = await this.db
      .select({
        month: sql<string>`TO_CHAR(${account.created_at}, 'YYYY-MM')`.as(
          'month'
        ),
        total: sql<string>`COALESCE(SUM(${plan.price})::text, '0')`.as('total'),
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(
          isNull(account.deleted_at),
          isNull(plan.deleted_at),
          ...accountDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${account.created_at}, 'YYYY-MM')`)
      .execute();

    const crossSellRevenueByMonth = await this.db
      .select({
        month:
          sql<string>`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM')`.as(
            'month'
          ),
        total:
          sql<string>`COALESCE(SUM((${planCrossSell.price} * ${planCrossSell.quantity})::numeric)::text, '0')`.as(
            'total'
          ),
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSellAccount.plan_cross_sell_id,
          planCrossSell.plan_cross_sell_id
        )
      )
      .where(
        and(
          isNull(planCrossSellAccount.deleted_at),
          isNull(planCrossSell.deleted_at),
          ...crossSellDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM')`)
      .execute();

    const expenseByMonth = await this.db
      .select({
        month: sql<string>`TO_CHAR(${expenditure.created_at}, 'YYYY-MM')`.as(
          'month'
        ),
        total: sql<string>`COALESCE(SUM(${expenditure.price})::text, '0')`.as(
          'total'
        ),
      })
      .from(expenditure)
      .where(and(isNull(expenditure.deleted_at), ...expenditureDateFilters))
      .groupBy(sql`TO_CHAR(${expenditure.created_at}, 'YYYY-MM')`)
      .execute();

    const monthMap = new Map<string, { income: number; expense: number }>();

    planRevenueByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    crossSellRevenueByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    expenseByMonth.forEach((item) => {
      const existing = monthMap.get(item.month) || { income: 0, expense: 0 };
      monthMap.set(item.month, {
        income: existing.income,
        expense: existing.expense + parseFloat(item.total || '0'),
      });
    });

    const monthNames: Record<string, string> = {
      '01': 'Janeiro',
      '02': 'Fevereiro',
      '03': 'Março',
      '04': 'Abril',
      '05': 'Maio',
      '06': 'Junho',
      '07': 'Julho',
      '08': 'Agosto',
      '09': 'Setembro',
      '10': 'Outubro',
      '11': 'Novembro',
      '12': 'Dezembro',
    };

    const result: FinancialReportItem[] = Array.from(monthMap.entries())
      .map(([month, data]) => {
        const monthNumber = month.split('-')[1];
        return {
          month: monthNames[monthNumber] || month,
          income: data.income.toFixed(2),
          expense: data.expense.toFixed(2),
          net: (data.income - data.expense).toFixed(2),
        };
      })
      .sort((a, b) => {
        const monthA = Object.keys(monthNames).indexOf(
          Object.keys(monthNames).find((k) => monthNames[k] === a.month) || ''
        );
        const monthB = Object.keys(monthNames).indexOf(
          Object.keys(monthNames).find((k) => monthNames[k] === b.month) || ''
        );
        return monthA - monthB;
      });

    return result;
  }

  async getDailyReport(
    query: ListFinancialReportRequest
  ): Promise<FinancialReportItem[]> {
    const accountDateFilters = this.getAccountDateFilters(query);
    const crossSellDateFilters = this.getCrossSellDateFilters(query);
    const expenditureDateFilters = this.getExpenditureDateFilters(query);

    const planRevenueByDay = await this.db
      .select({
        date: sql<string>`TO_CHAR(${account.created_at}, 'YYYY-MM-DD')`.as(
          'date'
        ),
        total: sql<string>`COALESCE(SUM(${plan.price})::text, '0')`.as('total'),
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(
          isNull(account.deleted_at),
          isNull(plan.deleted_at),
          ...accountDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${account.created_at}, 'YYYY-MM-DD')`)
      .execute();

    const crossSellRevenueByDay = await this.db
      .select({
        date: sql<string>`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM-DD')`.as(
          'date'
        ),
        total:
          sql<string>`COALESCE(SUM((${planCrossSell.price} * ${planCrossSell.quantity})::numeric)::text, '0')`.as(
            'total'
          ),
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSellAccount.plan_cross_sell_id,
          planCrossSell.plan_cross_sell_id
        )
      )
      .where(
        and(
          isNull(planCrossSellAccount.deleted_at),
          isNull(planCrossSell.deleted_at),
          ...crossSellDateFilters
        )
      )
      .groupBy(sql`TO_CHAR(${planCrossSellAccount.created_at}, 'YYYY-MM-DD')`)
      .execute();

    const expenseByDay = await this.db
      .select({
        date: sql<string>`TO_CHAR(${expenditure.created_at}, 'YYYY-MM-DD')`.as(
          'date'
        ),
        total: sql<string>`COALESCE(SUM(${expenditure.price})::text, '0')`.as(
          'total'
        ),
      })
      .from(expenditure)
      .where(and(isNull(expenditure.deleted_at), ...expenditureDateFilters))
      .groupBy(sql`TO_CHAR(${expenditure.created_at}, 'YYYY-MM-DD')`)
      .execute();

    const dayMap = new Map<string, { income: number; expense: number }>();

    planRevenueByDay.forEach((item) => {
      const existing = dayMap.get(item.date) || { income: 0, expense: 0 };
      dayMap.set(item.date, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    crossSellRevenueByDay.forEach((item) => {
      const existing = dayMap.get(item.date) || { income: 0, expense: 0 };
      dayMap.set(item.date, {
        income: existing.income + parseFloat(item.total || '0'),
        expense: existing.expense,
      });
    });

    expenseByDay.forEach((item) => {
      const existing = dayMap.get(item.date) || { income: 0, expense: 0 };
      dayMap.set(item.date, {
        income: existing.income,
        expense: existing.expense + parseFloat(item.total || '0'),
      });
    });

    const result: FinancialReportItem[] = Array.from(dayMap.entries())
      .map(([date, data]) => ({
        date: `${date}T00:00:00Z`,
        income: data.income.toFixed(2),
        expense: data.expense.toFixed(2),
        net: (data.income - data.expense).toFixed(2),
      }))
      .sort((a, b) => {
        const dateA = new Date(a.date || '').getTime();
        const dateB = new Date(b.date || '').getTime();
        return dateB - dateA;
      });

    return result;
  }
}
