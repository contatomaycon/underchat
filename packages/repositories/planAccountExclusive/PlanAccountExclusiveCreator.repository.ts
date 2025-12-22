import * as schema from '@core/models';
import { planAccountExclusive } from '@core/models';
import { CreatePlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/createPlanAccountExclusive/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class PlanAccountExclusiveCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createPlanAccountExclusive = async (
    input: CreatePlanAccountExclusiveRequest
  ): Promise<string | null> => {
    const planAccountExclusiveId = uuidv7();

    const result = await this.db
      .insert(planAccountExclusive)
      .values({
        plan_account_exclusive_id: planAccountExclusiveId,
        plan_id: input.plan_id,
        account_id: input.account_id,
      })
      .execute();

    if (!result) {
      return null;
    }

    return planAccountExclusiveId;
  };
}
