import * as schema from '@core/models';
import { planCrossSell } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class CrossSellDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteCrossSellById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    crossSellId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(planCrossSell)
      .set({
        deleted_at: date,
      })
      .where(eq(planCrossSell.plan_cross_sell_id, crossSellId))
      .execute();

    return result.rowCount === 1;
  };
}
