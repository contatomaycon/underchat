import * as schema from '@core/models';
import { plan } from '@core/models';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

@injectable()
export class PlanUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
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
      is_test?: boolean;
      days_trial?: number | null;
      is_exclusive?: boolean;
      status?: EPlanStatus;
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

    if (input.is_test !== undefined) {
      updateData.is_test = input.is_test ?? false;
    }

    if (input.days_trial !== undefined) {
      updateData.days_trial = input.days_trial;
    }

    if (input.is_exclusive !== undefined) {
      updateData.is_exclusive = input.is_exclusive ?? false;
    }

    if (input.status !== undefined && input.status !== null) {
      updateData.status = input.status;
    }

    const result = await this.db
      .update(plan)
      .set(updateData)
      .where(eq(plan.plan_id, planId))
      .execute();

    return result.rowCount === 1;
  };
}
