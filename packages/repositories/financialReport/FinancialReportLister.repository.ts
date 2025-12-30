import * as schema from '@core/models';
import { account, plan, accountPayment, expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, isNull, gte, lte, SQLWrapper, eq, inArray } from 'drizzle-orm';
import { ListFinancialReportRequest } from '@core/schema/financialReport/listFinancialReport/request.schema';
import {
  ListFinancialReportResponse,
  MonthlyDetail,
  DailyDetail,
} from '@core/schema/financialReport/listFinancialReport/response.schema';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';

@injectable()
export class FinancialReportListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (
    query: ListFinancialReportRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    filters.push(
      inArray(accountPayment.payment_status_id, [
        EPaymentStatus.received,
        EPaymentStatus.received_in_cash,
      ])
    );

    if (query.start_date) {
      filters.push(gte(accountPayment.created_at, query.start_date));
    }

    if (query.end_date) {
      filters.push(lte(accountPayment.created_at, query.end_date));
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

  private readonly processPaymentByPeriod = (
    payment: { value: string; created_at: string | null },
    period: 'monthly' | 'annual' | 'daily',
    incomeByMonth: Map<string, number>,
    incomeByYear: Map<string, number>,
    incomeByDay: Map<string, number>
  ): number => {
    const paymentValue = Number(payment.value);

    if (!payment.created_at) {
      return paymentValue;
    }

    const date = new Date(payment.created_at);

    if (period === 'monthly') {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      incomeByMonth.set(
        monthKey,
        (incomeByMonth.get(monthKey) || 0) + paymentValue
      );
      return paymentValue;
    }

    if (period === 'annual') {
      const yearKey = date.getFullYear().toString();
      incomeByYear.set(
        yearKey,
        (incomeByYear.get(yearKey) || 0) + paymentValue
      );
      return paymentValue;
    }

    if (period === 'daily') {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const dayKey = `${year}-${month}-${day}`;
      incomeByDay.set(dayKey, (incomeByDay.get(dayKey) || 0) + paymentValue);
    }

    return paymentValue;
  };

  private readonly formatMonthlyDetails = (
    monthMap: Map<string, number>
  ): MonthlyDetail[] => {
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

    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, income]) => {
        const [year, month] = monthKey.split('-');
        return {
          month: `${monthNames[Number.parseInt(month, 10) - 1]} ${year}`,
          income: income.toString(),
          outgoing: '0',
          net: income.toString(),
        };
      });
  };

  private readonly formatYearlyDetails = (
    yearMap: Map<string, number>
  ): MonthlyDetail[] => {
    return Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([yearKey, income]) => {
        return {
          month: yearKey,
          income: income.toString(),
          outgoing: '0',
          net: income.toString(),
        };
      });
  };

  private readonly formatDailyDetails = (
    dayMap: Map<string, number>
  ): DailyDetail[] => {
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, income]) => {
        const [year, month, day] = dayKey.split('-');
        const date = new Date(
          Number.parseInt(year, 10),
          Number.parseInt(month, 10) - 1,
          Number.parseInt(day, 10)
        );
        return {
          date: date.toLocaleDateString('pt-BR'),
          income: income.toString(),
          outgoing: '0',
          net: income.toString(),
        };
      });
  };

  private readonly processExpenditureByPeriod = (
    exp: { price: string; created_at: string | null },
    period: 'monthly' | 'annual' | 'daily',
    expenditureByMonth: Map<string, number>,
    expenditureByYear: Map<string, number>,
    expenditureByDay: Map<string, number>
  ): number => {
    const price = Number(exp.price);

    if (!exp.created_at) {
      return price;
    }

    const date = new Date(exp.created_at);

    if (period === 'monthly') {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      expenditureByMonth.set(
        monthKey,
        (expenditureByMonth.get(monthKey) || 0) + price
      );
      return price;
    }

    if (period === 'annual') {
      const yearKey = date.getFullYear().toString();
      expenditureByYear.set(
        yearKey,
        (expenditureByYear.get(yearKey) || 0) + price
      );
      return price;
    }

    if (period === 'daily') {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const dayKey = `${year}-${month}-${day}`;
      expenditureByDay.set(dayKey, (expenditureByDay.get(dayKey) || 0) + price);
    }

    return price;
  };

  private readonly formatExpenditureMonthlyDetails = (
    monthMap: Map<string, number>
  ): MonthlyDetail[] => {
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

    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, outgoing]) => {
        const [year, month] = monthKey.split('-');
        return {
          month: `${monthNames[Number.parseInt(month, 10) - 1]} ${year}`,
          income: '0',
          outgoing: outgoing.toString(),
          net: (-outgoing).toString(),
        };
      });
  };

  private readonly formatExpenditureYearlyDetails = (
    yearMap: Map<string, number>
  ): MonthlyDetail[] => {
    return Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([yearKey, outgoing]) => {
        return {
          month: yearKey,
          income: '0',
          outgoing: outgoing.toString(),
          net: (-outgoing).toString(),
        };
      });
  };

  private readonly formatExpenditureDailyDetails = (
    dayMap: Map<string, number>
  ): DailyDetail[] => {
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, outgoing]) => {
        const [year, month, day] = dayKey.split('-');
        const date = new Date(
          Number.parseInt(year, 10),
          Number.parseInt(month, 10) - 1,
          Number.parseInt(day, 10)
        );
        return {
          date: date.toLocaleDateString('pt-BR'),
          income: '0',
          outgoing: outgoing.toString(),
          net: (-outgoing).toString(),
        };
      });
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

    const paymentsResult = await this.dbRo
      .select({
        value: accountPayment.value,
        created_at: accountPayment.created_at,
      })
      .from(accountPayment)
      .innerJoin(plan, eq(accountPayment.plan_id, plan.plan_id))
      .innerJoin(account, eq(accountPayment.account_id, account.account_id))
      .where(
        and(isNull(plan.deleted_at), isNull(account.deleted_at), ...filters)
      )
      .execute();

    if (!paymentsResult.length) {
      return {
        total: '0',
        byMonth: query.period === 'monthly' ? [] : undefined,
        byDay: query.period === 'daily' ? [] : undefined,
        byYear: query.period === 'annual' ? [] : undefined,
      };
    }

    let totalIncome = 0;
    const incomeByMonth = new Map<string, number>();
    const incomeByDay = new Map<string, number>();
    const incomeByYear = new Map<string, number>();

    for (const payment of paymentsResult) {
      totalIncome += this.processPaymentByPeriod(
        payment,
        query.period,
        incomeByMonth,
        incomeByYear,
        incomeByDay
      );
    }

    const byMonth: MonthlyDetail[] | undefined =
      query.period === 'monthly'
        ? this.formatMonthlyDetails(incomeByMonth)
        : undefined;

    const byYear: MonthlyDetail[] | undefined =
      query.period === 'annual'
        ? this.formatYearlyDetails(incomeByYear)
        : undefined;

    const byDay: DailyDetail[] | undefined =
      query.period === 'daily'
        ? this.formatDailyDetails(incomeByDay)
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

    const expendituresResult = await this.dbRo
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
      totalExpenditure += this.processExpenditureByPeriod(
        exp,
        query.period,
        expenditureByMonth,
        expenditureByYear,
        expenditureByDay
      );
    }

    const byMonth: MonthlyDetail[] | undefined =
      query.period === 'monthly'
        ? this.formatExpenditureMonthlyDetails(expenditureByMonth)
        : undefined;

    const byYear: MonthlyDetail[] | undefined =
      query.period === 'annual'
        ? this.formatExpenditureYearlyDetails(expenditureByYear)
        : undefined;

    const byDay: DailyDetail[] | undefined =
      query.period === 'daily'
        ? this.formatExpenditureDailyDetails(expenditureByDay)
        : undefined;

    return {
      total: totalExpenditure.toString(),
      byMonth,
      byDay,
      byYear,
    };
  };

  private readonly combineMonthlyData = (
    incomeData: MonthlyDetail[] | undefined,
    expenditureData: MonthlyDetail[] | undefined
  ): MonthlyDetail[] => {
    const monthMap = new Map<string, MonthlyDetail>();

    if (incomeData) {
      for (const item of incomeData) {
        monthMap.set(item.month, {
          month: item.month,
          income: item.income,
          outgoing: '0',
          net: item.income,
        });
      }
    }

    if (expenditureData) {
      for (const item of expenditureData) {
        const existing = monthMap.get(item.month);
        if (existing) {
          existing.outgoing = item.outgoing;
          existing.net = (
            Number(existing.income) - Number(item.outgoing)
          ).toString();
          continue;
        }

        monthMap.set(item.month, item);
      }
    }

    return Array.from(monthMap.values()).sort((a, b) => {
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
  };

  private readonly combineYearlyData = (
    incomeData: MonthlyDetail[] | undefined,
    expenditureData: MonthlyDetail[] | undefined
  ): MonthlyDetail[] => {
    const yearMap = new Map<string, MonthlyDetail>();

    if (incomeData) {
      for (const item of incomeData) {
        yearMap.set(item.month, {
          month: item.month,
          income: item.income,
          outgoing: '0',
          net: item.income,
        });
      }
    }

    if (expenditureData) {
      for (const item of expenditureData) {
        const existing = yearMap.get(item.month);
        if (existing) {
          existing.outgoing = item.outgoing;
          existing.net = (
            Number(existing.income) - Number(item.outgoing)
          ).toString();
          continue;
        }

        yearMap.set(item.month, item);
      }
    }

    return Array.from(yearMap.values()).sort((a, b) => {
      return a.month.localeCompare(b.month);
    });
  };

  private readonly combineDailyData = (
    incomeData: DailyDetail[] | undefined,
    expenditureData: DailyDetail[] | undefined
  ): DailyDetail[] => {
    const dayMap = new Map<string, DailyDetail>();

    if (incomeData) {
      for (const item of incomeData) {
        dayMap.set(item.date, {
          date: item.date,
          income: item.income,
          outgoing: '0',
          net: item.income,
        });
      }
    }

    if (expenditureData) {
      for (const item of expenditureData) {
        const existing = dayMap.get(item.date);
        if (existing) {
          existing.outgoing = item.outgoing;
          existing.net = (
            Number(existing.income) - Number(item.outgoing)
          ).toString();
          continue;
        }

        dayMap.set(item.date, item);
      }
    }

    return Array.from(dayMap.values()).sort((a, b) => {
      const dateA = new Date(a.date.split('/').reverse().join('-'));
      const dateB = new Date(b.date.split('/').reverse().join('-'));
      return dateA.getTime() - dateB.getTime();
    });
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
      monthlyDetails = this.combineMonthlyData(
        incomeData.byMonth,
        expenditureData.byMonth
      );
    }

    if (query.period === 'annual') {
      monthlyDetails = this.combineYearlyData(
        incomeData.byYear,
        expenditureData.byYear
      );
    }

    let dailyDetails: DailyDetail[] | undefined = undefined;
    if (query.period === 'daily') {
      dailyDetails = this.combineDailyData(
        incomeData.byDay,
        expenditureData.byDay
      );
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
