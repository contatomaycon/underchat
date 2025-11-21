import * as schema from '@core/models';
import { planCrossSellAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class CrossSellAccountSingleDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteCrossSellAccountById = async (
    crossSellAccountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(planCrossSellAccount)
      .set({
        deleted_at: date,
      })
      .where(
        eq(planCrossSellAccount.plan_cross_sell_account_id, crossSellAccountId)
      )
      .execute();

    return (result.rowCount ?? 0) === 1;
  };
}
