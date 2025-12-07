import * as schema from '@core/models';
import { planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class PlanRecurringUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updatePlanRecurring = async (
    accountId: string,
    recurringPayment: boolean
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(planAccount)
      .set({
        recurring_payment: recurringPayment,
        updated_at: date,
      })
      .where(
        and(
          eq(planAccount.account_id, accountId),
          isNull(planAccount.cancellation_date)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
