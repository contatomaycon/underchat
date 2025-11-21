import * as schema from '@core/models';
import { planProduct, planProductDescription } from '@core/models';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PlanProductAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPlanProductAll = async (): Promise<ListPlanProductAllResponse[]> => {
    const result = await this.db
      .select({
        plan_product_id: planProduct.plan_product_id,
        name: planProductDescription.name,
        description: planProductDescription.description,
      })
      .from(planProduct)
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .execute();

    if (!result.length) {
      return [];
    }

    return result.map((item) => ({
      plan_product_id: item.plan_product_id,
      name: item.name ?? null,
      description: item.description ?? null,
    }));
  };
}
