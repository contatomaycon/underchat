import * as schema from '@core/models';
import { plan } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class PlanDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePlanById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    planId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(plan)
      .set({
        deleted_at: date,
      })
      .where(eq(plan.plan_id, planId))
      .execute();

    return result.rowCount === 1;
  };
}
