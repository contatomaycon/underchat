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
      description?: string | null;
      annual_discount?: string | null;
      icon?: string | null;
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

    if (input.description !== undefined) {
      updateData.description = input.description;
    }

    if (input.annual_discount !== undefined) {
      updateData.annual_discount = input.annual_discount?.toString() ?? null;
    }

    if (input.icon !== undefined) {
      updateData.icon = input.icon;
    }

    const result = await this.db
      .update(plan)
      .set(updateData)
      .where(eq(plan.plan_id, planId))
      .execute();

    return result.rowCount === 1;
  };
}
