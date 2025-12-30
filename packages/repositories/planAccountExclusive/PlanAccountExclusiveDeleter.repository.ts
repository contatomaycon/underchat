import * as schema from '@core/models';
import { planAccountExclusive } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PlanAccountExclusiveDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePlanAccountExclusiveById = async (
    planAccountExclusiveId: string
  ): Promise<boolean> => {
    const result = await this.db
      .delete(planAccountExclusive)
      .where(
        eq(
          planAccountExclusive.plan_account_exclusive_id,
          planAccountExclusiveId
        )
      )
      .execute();

    return (result.rowCount ?? 0) === 1;
  };
}
