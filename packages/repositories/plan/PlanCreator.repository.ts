import * as schema from '@core/models';
import { plan } from '@core/models';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

@injectable()
export class PlanCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createPlan = async (input: CreatePlanRequest): Promise<string | null> => {
    const planId = uuidv7();

    const result = await this.dbRw
      .insert(plan)
      .values({
        plan_id: planId,
        name: input.name,
        price: input.price.toString(),
        price_old: input.price_old.toString(),
        description: input.description ?? null,
        annual_discount: input.annual_discount?.toString() ?? null,
        icon: input.icon ?? null,
        is_test: input.is_test ?? false,
        days_trial: input.days_trial ?? null,
        is_exclusive: input.is_exclusive ?? false,
        status: input.status ?? EPlanStatus.active,
      })
      .execute();

    if (!result) {
      return null;
    }

    return planId;
  };
}
