import * as schema from '@core/models';
import { planAccount, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, gte, lte, sql } from 'drizzle-orm';
import { IPlanAccountExpiring } from '@core/common/interfaces/IPlanAccountExpiring';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class PlanExpirationReminderRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findPlansExpiringInDays = async (
    days: number
  ): Promise<IPlanAccountExpiring[]> => {
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + days);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await this.dbRo
      .select({
        plan_account_id: planAccount.plan_account_id,
        account_id: planAccount.account_id,
        next_payment_date: planAccount.next_payment_date,
        days_until_expiration: sql<number>`${days}`.as('days_until_expiration'),
      })
      .from(planAccount)
      .innerJoin(account, eq(planAccount.account_id, account.account_id))
      .where(
        and(
          isNull(planAccount.cancellation_date),
          eq(account.account_status_id, EAccountStatus.active),
          gte(planAccount.next_payment_date, startOfDay.toISOString()),
          lte(planAccount.next_payment_date, endOfDay.toISOString())
        )
      )
      .execute();

    return result;
  };
}
