import * as schema from '@core/models';
import { planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull } from 'drizzle-orm';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class PlanAccountUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.db.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        plan_id: true,
        recurring_payment: true,
        billing_period_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
        value: true,
      },
    });
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    const updateData: {
      plan_id: string;
      recurring_payment: boolean;
      billing_period_id: string;
      last_payment_date: string | null;
      next_payment_date: string | null;
      cancellation_date: string | null;
      value: string;
      updated_at: string;
    } = {
      plan_id: input.plan_id,
      recurring_payment: input.recurring_payment,
      billing_period_id: input.billing_period_id,
      last_payment_date: input.last_payment_date || null,
      next_payment_date: input.next_payment_date || null,
      cancellation_date: input.cancellation_date || null,
      value: input.value,
      updated_at: currentTime(),
    };

    const result = await this.db
      .update(planAccount)
      .set(updateData)
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
