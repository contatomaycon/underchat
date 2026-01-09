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
    if (!accountId || typeof accountId !== 'string') {
      throw new Error('accountId is required and must be a string');
    }

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

    const monthBoundaries = monthDates.map((m, i) => ({
      end: m.monthEnd,
      order: i + 1,
    }));

    const firstMonthStart = monthDates[0].monthStart.toISOString();
    const lastMonthEnd = monthDates[monthDates.length - 1].monthEnd;

    const query = `
      WITH base_count AS (
        SELECT COUNT(*) AS total
        FROM contact
        WHERE account_id = '${accountId}'
          AND deleted_at IS NULL
          AND created_at < '${firstMonthStart}'::timestamp
      ),
      month_boundaries AS (
        SELECT * FROM (VALUES
          ${monthBoundaries.map((m) => `('${m.end}'::timestamp, ${m.order})`).join(',\n          ')}
        ) AS t(month_end, month_order)
      ),
      monthly_new_contacts AS (
        SELECT 
          DATE_TRUNC('month', c.created_at) AS month_start,
          COUNT(*) AS new_count
        FROM contact c
        WHERE c.account_id = '${accountId}'
          AND c.deleted_at IS NULL
          AND c.created_at >= '${firstMonthStart}'::timestamp
          AND c.created_at < '${lastMonthEnd}'::timestamp
        GROUP BY DATE_TRUNC('month', c.created_at)
      ),
      cumulative AS (
        SELECT 
          mb.month_end,
          mb.month_order,
          COALESCE(SUM(mnc.new_count) OVER (ORDER BY mb.month_order), 0) AS cumulative_new
        FROM month_boundaries mb
        LEFT JOIN monthly_new_contacts mnc 
          ON DATE_TRUNC('month', mb.month_end - INTERVAL '1 day') = mnc.month_start
      )
      SELECT 
        c.month_end,
        (SELECT total FROM base_count) + c.cumulative_new AS total
      FROM cumulative c
      ORDER BY c.month_order ASC
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
