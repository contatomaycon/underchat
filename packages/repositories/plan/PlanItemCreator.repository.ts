import * as schema from '@core/models';
import { planItems } from '@core/models';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class PlanItemCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createPlanItem = async (
    input: CreatePlanItemRequest
  ): Promise<string | null> => {
    const planItemId = uuidv7();

    const result = await this.db
      .insert(planItems)
      .values({
        plan_item_id: planItemId,
        plan_id: input.plan_id,
        plan_product_id: input.plan_product_id,
        quantity: input.quantity,
      })
      .execute();

    if (!result) {
      return null;
    }

    return planItemId;
  };
}
