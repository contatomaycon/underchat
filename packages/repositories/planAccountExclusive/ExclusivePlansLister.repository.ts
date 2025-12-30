import * as schema from '@core/models';
import { plan, planAccountExclusive } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, notInArray, SQLWrapper } from 'drizzle-orm';
import { ListExclusivePlansResponse } from '@core/schema/planAccountExclusive/listExclusivePlans/response.schema';

@injectable()
export class ExclusivePlansListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listExclusivePlans = async (
    accountId: string
  ): Promise<ListExclusivePlansResponse[]> => {
    const existingExclusivePlanIds = await this.db
      .select({
        plan_id: planAccountExclusive.plan_id,
      })
      .from(planAccountExclusive)
      .where(eq(planAccountExclusive.account_id, accountId))
      .execute();

    const existingPlanIds = existingExclusivePlanIds.map((p) => p.plan_id);

    const whereConditions: SQLWrapper[] = [
      eq(plan.is_exclusive, true),
      isNull(plan.deleted_at),
    ];

    if (existingPlanIds.length > 0) {
      whereConditions.push(notInArray(plan.plan_id, existingPlanIds));
    }

    const result = await this.db
      .select({
        plan_id: plan.plan_id,
        name: plan.name,
        is_exclusive: plan.is_exclusive,
        status: plan.status,
      })
      .from(plan)
      .where(and(...whereConditions))
      .execute();

    if (!result.length) {
      return [];
    }

    const plans: ListExclusivePlansResponse[] = result.map((item) => ({
      plan_id: item.plan_id,
      name: item.name,
      is_exclusive: item.is_exclusive,
      status: item.status,
    }));

    return plans;
  };
}
