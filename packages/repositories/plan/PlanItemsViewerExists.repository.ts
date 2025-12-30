import * as schema from '@core/models';
import { planItems } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  eq,
  isNull,
  and,
  ExtractTablesWithRelations,
  count,
} from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class PlanItemsViewerExistsRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsPlanItemsByPlanId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    planId: string
  ): Promise<boolean> => {
    const result = await tx
      .select({ total: count() })
      .from(planItems)
      .where(and(eq(planItems.plan_id, planId), isNull(planItems.deleted_at)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
