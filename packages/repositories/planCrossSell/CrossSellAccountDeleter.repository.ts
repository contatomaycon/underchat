import * as schema from '@core/models';
import { planCrossSellAccount } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ExtractTablesWithRelations } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class CrossSellAccountDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteCrossSellAccountsByCrossSellId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    crossSellId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(planCrossSellAccount)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(planCrossSellAccount.plan_cross_sell_id, crossSellId),
          isNull(planCrossSellAccount.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) >= 0;
  };
}
