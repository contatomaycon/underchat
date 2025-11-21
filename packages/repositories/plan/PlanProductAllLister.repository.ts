import * as schema from '@core/models';
import { planProduct } from '@core/models';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class PlanProductAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPlanProductAll = async (): Promise<ListPlanProductAllResponse[]> => {
    const result = await this.db
      .select({
        plan_product_id: planProduct.plan_product_id,
        name: planProduct.name,
      })
      .from(planProduct)
      .execute();

    if (!result.length) {
      return [];
    }

    return result as ListPlanProductAllResponse[];
  };
}
