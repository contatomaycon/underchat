import * as schema from '@core/models';
import { plan } from '@core/models';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';
import { isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class PlanAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPlanAll = async (): Promise<ListPlanAllResponse[]> => {
    const result = await this.db
      .select({
        plan_id: plan.plan_id,
        name: plan.name,
      })
      .from(plan)
      .where(isNull(plan.deleted_at))
      .execute();

    if (!result.length) {
      return [];
    }

    return result as ListPlanAllResponse[];
  };
}
