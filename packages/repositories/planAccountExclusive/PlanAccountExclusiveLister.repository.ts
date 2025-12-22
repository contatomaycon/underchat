import * as schema from '@core/models';
import { planAccountExclusive, plan } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ListPlanAccountExclusiveResponse } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/response.schema';

@injectable()
export class PlanAccountExclusiveListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPlanAccountExclusives = async (
    accountId: string
  ): Promise<ListPlanAccountExclusiveResponse[]> => {
    const result = await this.db
      .select({
        plan_account_exclusive_id:
          planAccountExclusive.plan_account_exclusive_id,
        plan_id: planAccountExclusive.plan_id,
        account_id: planAccountExclusive.account_id,
        created_at: planAccountExclusive.created_at,
        plan: {
          plan_id: plan.plan_id,
          name: plan.name,
          is_exclusive: plan.is_exclusive,
        },
      })
      .from(planAccountExclusive)
      .leftJoin(plan, eq(planAccountExclusive.plan_id, plan.plan_id))
      .where(eq(planAccountExclusive.account_id, accountId))
      .execute();

    if (!result.length) {
      return [];
    }

    const exclusives: ListPlanAccountExclusiveResponse[] = result.map(
      (item) => ({
        plan_account_exclusive_id: item.plan_account_exclusive_id,
        plan_id: item.plan_id,
        account_id: item.account_id,
        created_at: item.created_at,
        plan: item.plan?.plan_id
          ? {
              plan_id: item.plan.plan_id,
              name: item.plan.name,
              is_exclusive: item.plan.is_exclusive,
            }
          : null,
      })
    );

    return exclusives;
  };
}
