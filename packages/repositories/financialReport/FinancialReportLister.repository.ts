import * as schema from '@core/models';
import {
  account,
  plan,
  planCrossSellAccount,
  planCrossSell,
  planProduct,
  planProductDescription,
  expenditure,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  isNull,
  gte,
  lte,
  sql,
  SQLWrapper,
  inArray,
  eq,
} from 'drizzle-orm';
import { ListFinancialReportRequest } from '@core/schema/financialReport/listFinancialReport/request.schema';
import {
  ListFinancialReportResponse,
  MonthlyDetail,
  DailyDetail,
} from '@core/schema/financialReport/listFinancialReport/response.schema';

@injectable()
export class FinancialReportListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (
    query: ListFinancialReportRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.start_date) {
      filters.push(gte(account.created_at, query.start_date));
    }

    if (query.end_date) {
      filters.push(lte(account.created_at, query.end_date));
    }

    return filters;
  };

  private readonly setExpenditureFilters = (
    query: ListFinancialReportRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.start_date) {
      filters.push(gte(expenditure.created_at, query.start_date));
    }

    if (query.end_date) {
      filters.push(lte(expenditure.created_at, query.end_date));
    }

    return filters;
  };

  private readonly getIncomeData = async (
    query: ListFinancialReportRequest
  ): Promise<{
    total: string;
    byMonth?: MonthlyDetail[];
    byDay?: DailyDetail[];
    byYear?: MonthlyDetail[];
  }> => {
    const filters = this.setFilters(query);

    const planSalesResult = await this.db
      .select({
        account_id: account.account_id,
        plan_id: plan.plan_id,
        price: plan.price,
        created_at: account.created_at,
      })
      .from(account)
      .innerJoin(plan, eq(account.plan_id, plan.plan_id))
      .where(
        and(isNull(account.deleted_at), isNull(plan.deleted_at), ...filters)
      )
      .execute();

    if (!planSalesResult.length) {
      return {
        total: '0',
        byMonth: query.period === 'monthly' ? [] : undefined,
        byDay: query.period === 'daily' ? [] : undefined,
        byYear: query.period === 'annual' ? [] : undefined,
      };
    }

    const accountIds = planSalesResult.map((a) => a.account_id);

    const crossSellFilters = [
      inArray(planCrossSellAccount.account_id, accountIds),
      isNull(planCrossSellAccount.deleted_at),
      isNull(planCrossSell.deleted_at),
    ];

    if (query.start_date) {
      crossSellFilters.push(
        gte(planCrossSellAccount.created_at, query.start_date)
      );
    }

    if (query.end_date) {
      crossSellFilters.push(
        lte(planCrossSellAccount.created_at, query.end_date)
      );
    }

    const crossSellsResult = accountIds.length
      ? await this.db
          .select({
            account_id: planCrossSellAccount.account_id,
            price: planCrossSell.price,
            created_at: planCrossSellAccount.created_at,
          })
          .from(planCrossSellAccount)
          .innerJoin(
            planCrossSell,
            eq(
              planCrossSellAccount.plan_cross_sell_id,
              planCrossSell.plan_cross_sell_id
            )
          )
          .where(and(...crossSellFilters))
          .execute()
      : [];

    let totalIncome = 0;
    const incomeByMonth = new Map<string, number>();
    const incomeByDay = new Map<string, number>();
    const incomeByYear = new Map<string, number>();

    for (const planSale of planSalesResult) {
      const planPrice = Number(planSale.price);
      totalIncome += planPrice;

      if (query.period === 'monthly' && planSale.created_at) {
        const date = new Date(planSale.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        incomeByMonth.set(
          monthKey,
          (incomeByMonth.get(monthKey) || 0) + planPrice
        );
      }

      if (query.period === 'annual' && planSale.created_at) {
        const date = new Date(planSale.created_at);
        const yearKey = date.getFullYear().toString();
        incomeByYear.set(yearKey, (incomeByYear.get(yearKey) || 0) + planPrice);
      }

      if (query.period === 'daily' && planSale.created_at) {
        const date = new Date(planSale.created_at);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dayKey = `${year}-${month}-${day}`;
        incomeByDay.set(dayKey, (incomeByDay.get(dayKey) || 0) + planPrice);
      }
    }

    for (const crossSell of crossSellsResult) {
      const addonPrice = Number(crossSell.price);
      totalIncome += addonPrice;

      if (query.period === 'monthly' && crossSell.created_at) {
        const date = new Date(crossSell.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        incomeByMonth.set(
          monthKey,
          (incomeByMonth.get(monthKey) || 0) + addonPrice
        );
      }

      if (query.period === 'annual' && crossSell.created_at) {
        const date = new Date(crossSell.created_at);
        const yearKey = date.getFullYear().toString();
        incomeByYear.set(
          yearKey,
          (incomeByYear.get(yearKey) || 0) + addonPrice
        );
      }

      if (query.period === 'daily' && crossSell.created_at) {
        const date = new Date(crossSell.created_at);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dayKey = `${year}-${month}-${day}`;
        incomeByDay.set(dayKey, (incomeByDay.get(dayKey) || 0) + addonPrice);
      }
    }

    const byMonth: MonthlyDetail[] | undefined =
      query.period === 'monthly'
        ? Array.from(incomeByMonth.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([monthKey, income]) => {
              const [year, month] = monthKey.split('-');
              const monthNames = [
                'Janeiro',
                'Fevereiro',
                'Março',
                'Abril',
                'Maio',
                'Junho',
                'Julho',
                'Agosto',
                'Setembro',
                'Outubro',
                'Novembro',
                'Dezembro',
              ];
              return {
                month: `${monthNames[parseInt(month) - 1]} ${year}`,
                income: income.toString(),
                outgoing: '0',
                net: income.toString(),
              };
            })
        : undefined;

    const byYear: MonthlyDetail[] | undefined =
      query.period === 'annual'
        ? Array.from(incomeByYear.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([yearKey, income]) => {
              return {
                month: yearKey,
                income: income.toString(),
                outgoing: '0',
                net: income.toString(),
              };
            })
        : undefined;

    const byDay: DailyDetail[] | undefined =
      query.period === 'daily'
        ? Array.from(incomeByDay.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dayKey, income]) => {
              const [year, month, day] = dayKey.split('-');
              const date = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day)
              );
              return {
                date: date.toLocaleDateString('pt-BR'),
                income: income.toString(),
                outgoing: '0',
                net: income.toString(),
              };
            })
        : undefined;

    return {
      total: totalIncome.toString(),
      byMonth,
      byDay,
      byYear,
    };
  };

  private readonly getExpenditureData = async (
    query: ListFinancialReportRequest
  ): Promise<{
    total: string;
    byMonth?: MonthlyDetail[];
    byDay?: DailyDetail[];
    byYear?: MonthlyDetail[];
  }> => {
    const filters = this.setExpenditureFilters(query);

    const expendituresResult = await this.db
      .select({
        price: expenditure.price,
        created_at: expenditure.created_at,
      })
      .from(expenditure)
      .where(and(isNull(expenditure.deleted_at), ...filters))
      .execute();

    if (!expendituresResult.length) {
      return {
        total: '0',
        byMonth: query.period === 'monthly' ? [] : undefined,
        byDay: query.period === 'daily' ? [] : undefined,
        byYear: query.period === 'annual' ? [] : undefined,
      };
    }

    let totalExpenditure = 0;
    const expenditureByMonth = new Map<string, number>();
    const expenditureByDay = new Map<string, number>();
    const expenditureByYear = new Map<string, number>();

    for (const exp of expendituresResult) {
      const price = Number(exp.price);
      totalExpenditure += price;

      if (query.period === 'monthly' && exp.created_at) {
        const date = new Date(exp.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        expenditureByMonth.set(
          monthKey,
          (expenditureByMonth.get(monthKey) || 0) + price
        );
      }

      if (query.period === 'annual' && exp.created_at) {
        const date = new Date(exp.created_at);
        const yearKey = date.getFullYear().toString();
        expenditureByYear.set(
          yearKey,
          (expenditureByYear.get(yearKey) || 0) + price
        );
      }

      if (query.period === 'daily' && exp.created_at) {
        const date = new Date(exp.created_at);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dayKey = `${year}-${month}-${day}`;
        expenditureByDay.set(
          dayKey,
          (expenditureByDay.get(dayKey) || 0) + price
        );
      }
    }

    const byMonth: MonthlyDetail[] | undefined =
      query.period === 'monthly'
        ? Array.from(expenditureByMonth.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([monthKey, outgoing]) => {
              const [year, month] = monthKey.split('-');
              const monthNames = [
                'Janeiro',
                'Fevereiro',
                'Março',
                'Abril',
                'Maio',
                'Junho',
                'Julho',
                'Agosto',
                'Setembro',
                'Outubro',
                'Novembro',
                'Dezembro',
              ];
              return {
                month: `${monthNames[parseInt(month) - 1]} ${year}`,
                income: '0',
                outgoing: outgoing.toString(),
                net: (-outgoing).toString(),
              };
            })
        : undefined;

    const byYear: MonthlyDetail[] | undefined =
      query.period === 'annual'
        ? Array.from(expenditureByYear.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([yearKey, outgoing]) => {
              return {
                month: yearKey,
                income: '0',
                outgoing: outgoing.toString(),
                net: (-outgoing).toString(),
              };
            })
        : undefined;

    const byDay: DailyDetail[] | undefined =
      query.period === 'daily'
        ? Array.from(expenditureByDay.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dayKey, outgoing]) => {
              const [year, month, day] = dayKey.split('-');
              const date = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day)
              );
              return {
                date: date.toLocaleDateString('pt-BR'),
                income: '0',
                outgoing: outgoing.toString(),
                net: (-outgoing).toString(),
              };
            })
        : undefined;

    return {
      total: totalExpenditure.toString(),
      byMonth,
      byDay,
      byYear,
    };
  };

  listFinancialReport = async (
    query: ListFinancialReportRequest
  ): Promise<ListFinancialReportResponse> => {
    const [incomeData, expenditureData] = await Promise.all([
      this.getIncomeData(query),
      this.getExpenditureData(query),
    ]);

    const totalIncome = Number(incomeData.total);
    const totalExpenditure = Number(expenditureData.total);
    const totalNet = totalIncome - totalExpenditure;

    let monthlyDetails: MonthlyDetail[] | undefined = undefined;
    if (query.period === 'monthly') {
      const monthMap = new Map<string, MonthlyDetail>();

      if (incomeData.byMonth) {
        for (const item of incomeData.byMonth) {
          monthMap.set(item.month, {
            month: item.month,
            income: item.income,
            outgoing: '0',
            net: item.income,
          });
        }
      }

      if (expenditureData.byMonth) {
        for (const item of expenditureData.byMonth) {
          const existing = monthMap.get(item.month);
          if (existing) {
            existing.outgoing = item.outgoing;
            existing.net = (
              Number(existing.income) - Number(item.outgoing)
            ).toString();
          } else {
            monthMap.set(item.month, item);
          }
        }
      }

      monthlyDetails = Array.from(monthMap.values()).sort((a, b) => {
        const [monthA, yearA] = a.month.split(' ');
        const [monthB, yearB] = b.month.split(' ');
        const monthNames = [
          'Janeiro',
          'Fevereiro',
          'Março',
          'Abril',
          'Maio',
          'Junho',
          'Julho',
          'Agosto',
          'Setembro',
          'Outubro',
          'Novembro',
          'Dezembro',
        ];
        const monthIndexA = monthNames.indexOf(monthA);
        const monthIndexB = monthNames.indexOf(monthB);
        if (yearA !== yearB) {
          return yearA.localeCompare(yearB);
        }
        return monthIndexA - monthIndexB;
      });
    }

    if (query.period === 'annual') {
      const yearMap = new Map<string, MonthlyDetail>();

      if (incomeData.byYear) {
        for (const item of incomeData.byYear) {
          yearMap.set(item.month, {
            month: item.month,
            income: item.income,
            outgoing: '0',
            net: item.income,
          });
        }
      }

      if (expenditureData.byYear) {
        for (const item of expenditureData.byYear) {
          const existing = yearMap.get(item.month);
          if (existing) {
            existing.outgoing = item.outgoing;
            existing.net = (
              Number(existing.income) - Number(item.outgoing)
            ).toString();
          } else {
            yearMap.set(item.month, item);
          }
        }
      }

      monthlyDetails = Array.from(yearMap.values()).sort((a, b) => {
        return a.month.localeCompare(b.month);
      });
    }

    let dailyDetails: DailyDetail[] | undefined = undefined;
    if (query.period === 'daily') {
      const dayMap = new Map<string, DailyDetail>();

      if (incomeData.byDay) {
        for (const item of incomeData.byDay) {
          dayMap.set(item.date, {
            date: item.date,
            income: item.income,
            outgoing: '0',
            net: item.income,
          });
        }
      }

      if (expenditureData.byDay) {
        for (const item of expenditureData.byDay) {
          const existing = dayMap.get(item.date);
          if (existing) {
            existing.outgoing = item.outgoing;
            existing.net = (
              Number(existing.income) - Number(item.outgoing)
            ).toString();
          } else {
            dayMap.set(item.date, item);
          }
        }
      }

      dailyDetails = Array.from(dayMap.values()).sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA.getTime() - dateB.getTime();
      });
    }

    return {
      total_income: totalIncome.toString(),
      total_outgoing: totalExpenditure.toString(),
      total_net: totalNet.toString(),
      monthly_details: monthlyDetails,
      daily_details: dailyDetails,
    };
  };
}
