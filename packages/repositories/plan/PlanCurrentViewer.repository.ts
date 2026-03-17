import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewCurrentPlanResponse } from '@core/schema/plan/viewCurrentPlan/response.schema';
import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';

@injectable()
export class PlanCurrentViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewCurrentPlan = async (
    accountId: string
  ): Promise<ViewCurrentPlanResponse> => {
    const accountResult = await this.dbRo.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
            last_payment_date: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
              },
            },
            bpl: {
              columns: {
                name: true,
              },
            },
          },
        },
      },
      columns: {
        account_id: true,
      },
    });

    if (!accountResult) {
      return {
        plan_id: null,
        billing_period: null,
        next_payment_date: null,
        last_payment_date: null,
      };
    }

    const now = new Date();
    const activePlanAccount = accountResult.apc?.find((pa) => {
      if (!pa.next_payment_date) return false;
      const nextPaymentDate = new Date(pa.next_payment_date);
      return nextPaymentDate > now;
    });

    if (!activePlanAccount) {
      return {
        plan_id: null,
        billing_period: null,
        next_payment_date: null,
        last_payment_date: null,
      };
    }

    const billingPeriodName =
      activePlanAccount.bpl?.name ||
      calculateBillingPeriodByDates(
        activePlanAccount.last_payment_date,
        activePlanAccount.next_payment_date
      );

    return {
      plan_id: activePlanAccount.ppl?.plan_id ?? null,
      billing_period:
        billingPeriodName === 'annual'
          ? 'annual'
          : billingPeriodName === 'monthly'
            ? 'monthly'
            : null,
      next_payment_date: activePlanAccount.next_payment_date ?? null,
      last_payment_date: activePlanAccount.last_payment_date ?? null,
    };
  };
}
