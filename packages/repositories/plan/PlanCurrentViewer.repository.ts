import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewCurrentPlanResponse } from '@core/schema/plan/viewCurrentPlan/response.schema';

@injectable()
export class PlanCurrentViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
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
          },
          with: {
            pas: {
              columns: {
                plan_account_status_id: true,
                name: true,
              },
            },
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

    const activePlanAccount = accountResult.apc?.find(
      (pa) => pa.pas?.name === 'active'
    );

    return {
      plan_id: activePlanAccount?.ppl?.plan_id ?? null,
    };
  };
}
