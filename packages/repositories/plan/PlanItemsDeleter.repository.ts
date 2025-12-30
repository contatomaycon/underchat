import * as schema from '@core/models';
import { planItems } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class PlanItemsDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePlanItemsByPlanId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    planId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(planItems)
      .set({
        deleted_at: date,
      })
      .where(eq(planItems.plan_id, planId))
      .execute();

    return (result.rowCount ?? 0) >= 0;
  };
}
