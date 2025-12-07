import * as schema from '@core/models';
import { planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class PlanAccountCancellerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountWithPayment = async (accountId: string) => {
    return this.db.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        account_payment_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
      },
      with: {
        apy: {
          columns: {
            account_payment_id: true,
            billing: true,
            recurring_payment: true,
          },
        },
      },
    });
  };

  findPlanAccountById = async (planAccountId: string) => {
    return this.db.query.planAccount.findFirst({
      where: and(
        eq(planAccount.plan_account_id, planAccountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        account_id: true,
        account_payment_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
      },
      with: {
        apy: {
          columns: {
            account_payment_id: true,
            billing: true,
            recurring_payment: true,
          },
        },
      },
    });
  };

  cancelPlanAccount = async (
    accountId: string,
    cancellationDate: string,
    shouldCancelNextPayment: boolean
  ): Promise<boolean> => {
    const updateData: {
      cancellation_date: string;
      next_payment_date?: null;
      updated_at: string;
    } = {
      cancellation_date: cancellationDate,
      updated_at: currentTime(),
    };

    if (shouldCancelNextPayment) {
      updateData.next_payment_date = null;
    }

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
