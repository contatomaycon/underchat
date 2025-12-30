import * as schema from '@core/models';
import { planItems } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class PlanItemDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePlanItemById = async (planItemId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(planItems)
      .set({
        deleted_at: date,
      })
      .where(eq(planItems.plan_item_id, planItemId))
      .execute();

    return result.rowCount === 1;
  };
}
