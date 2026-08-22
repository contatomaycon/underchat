import * as schema from '@core/models';
import { planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';

@injectable()
export class PlanRecurringUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updatePlanRecurring = async (
    accountId: string,
    recurringPayment: boolean
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const currentPlans = await tx
        .select({
          plan_account_id: planAccount.plan_account_id,
          cancellation_date: planAccount.cancellation_date,
        })
        .from(planAccount)
        .where(eq(planAccount.account_id, accountId))
        .orderBy(
          sql`${planAccount.updated_at} DESC NULLS LAST`,
          sql`${planAccount.created_at} DESC NULLS LAST`,
          sql`${planAccount.plan_account_id} DESC`
        )
        .limit(1)
        .for('update')
        .execute();

      const currentPlan = currentPlans[0];
      if (!currentPlan || currentPlan.cancellation_date) {
        return false;
      }

      const result = await tx
        .update(planAccount)
        .set({
          recurring_payment: recurringPayment,
        })
        .where(
          and(
            eq(planAccount.plan_account_id, currentPlan.plan_account_id),
            isNull(planAccount.cancellation_date)
          )
        )
        .execute();

      return (result.rowCount ?? 0) > 0;
    });
  };
}
