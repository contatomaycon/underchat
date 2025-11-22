import * as schema from '@core/models';
import { plan } from '@core/models';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class PlanCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createPlan = async (input: CreatePlanRequest): Promise<string | null> => {
    const planId = uuidv7();

    const result = await this.db
      .insert(plan)
      .values({
        plan_id: planId,
        name: input.name,
        price: input.price.toString(),
        price_old: input.price_old.toString(),
      })
      .execute();

    if (!result) {
      return null;
    }

    return planId;
  };
}
