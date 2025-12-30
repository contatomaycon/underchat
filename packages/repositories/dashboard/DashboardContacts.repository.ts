import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, lt } from 'drizzle-orm';

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

    const monthPromises = Array.from({ length: 12 }, async (_, index) => {
      const i = 11 - index;
      const monthStart = new Date(currentMonth);
      monthStart.setMonth(monthStart.getMonth() - i);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const monthName = monthStart.toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
      });

      const cumulativeResult = await this.dbRo
        .select({
          total: count(),
        })
        .from(contact)
        .where(
          and(
            eq(contact.account_id, accountId),
            isNull(contact.deleted_at),
            lt(contact.created_at, monthEnd.toISOString())
          )
        )
        .execute();

      return {
        month: monthName,
        total: cumulativeResult[0]?.total ?? 0,
      };
    });

    return Promise.all(monthPromises);
  };
}
