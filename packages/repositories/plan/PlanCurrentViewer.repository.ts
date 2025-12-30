import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewCurrentPlanResponse } from '@core/schema/plan/viewCurrentPlan/response.schema';

@injectable()
export class PlanCurrentViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewCurrentPlan = async (
    accountId: string
  ): Promise<ViewCurrentPlanResponse> => {
    const accountResult = await this.db.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
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
      return { plan_id: null };
    }

    const now = new Date();
    const activePlanAccount = accountResult.apc?.find((pa) => {
      if (!pa.next_payment_date) return false;
      const nextPaymentDate = new Date(pa.next_payment_date);
      return nextPaymentDate > now;
    });

    return {
      plan_id: activePlanAccount?.ppl?.plan_id ?? null,
    };
  };
}
