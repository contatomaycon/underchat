import * as schema from '@core/models';
import { planCrossSellAccount } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class CrossSellAccountViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsCrossSellAccountsByCrossSellId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    crossSellId: string
  ): Promise<boolean> => {
    const result = await tx
      .select()
      .from(planCrossSellAccount)
      .where(
        and(
          eq(planCrossSellAccount.plan_cross_sell_id, crossSellId),
          isNull(planCrossSellAccount.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
