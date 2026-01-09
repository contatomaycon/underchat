import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class DashboardContactsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getContactsGrowthMonthly = async (
    accountId: string
  ): Promise<Array<{ month: string; total: number }>> => {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const monthDates = Array.from({ length: 12 }, (_, index) => {
      const i = 11 - index;
      const monthStart = new Date(currentMonth);
      monthStart.setMonth(monthStart.getMonth() - i);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      return {
        monthStart,
        monthEnd: monthEnd.toISOString(),
      };
    });

    const monthEndDates = monthDates.map((m) => m.monthEnd);

    const query = `
      WITH month_ends AS (
        SELECT unnest(ARRAY[${monthEndDates
          .map((date) => `'${date}'::timestamp`)
          .join(',')}]) AS month_end
      )
      SELECT 
        me.month_end,
        (
          SELECT COUNT(*)
          FROM contact c
          WHERE c.account_id = '${accountId}'
            AND c.deleted_at IS NULL
            AND c.created_at < me.month_end
        ) AS total
      FROM month_ends me
      ORDER BY me.month_end ASC
    `;

    const result = await this.dbRo.execute(query);

    return monthDates.map(({ monthStart }, index) => {
      const monthName = monthStart.toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
      });

      const row = result.rows[index];

      return {
        month: monthName,
        total: row ? Number(row.total) : 0,
      };
    });
  };
}
