import * as schema from '@core/models';
import { plan } from '@core/models';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PlanUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updatePlan = async (
    planId: string,
    input: UpdatePlanRequest
  ): Promise<boolean> => {
    const updateData: {
      name?: string;
      price?: string;
      price_old?: string;
    } = {};

    if (input.name !== null && input.name !== undefined) {
      updateData.name = input.name;
    }

    if (input.price !== null && input.price !== undefined) {
      updateData.price = input.price.toString();
    }

    if (input.price_old !== null && input.price_old !== undefined) {
      updateData.price_old = input.price_old.toString();
    }

    const result = await this.db
      .update(plan)
      .set(updateData)
      .where(eq(plan.plan_id, planId))
      .execute();

    return result.rowCount === 1;
  };
}
