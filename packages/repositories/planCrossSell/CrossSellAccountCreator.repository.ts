import * as schema from '@core/models';
import { planCrossSellAccount } from '@core/models';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class CrossSellAccountCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createCrossSellAccount = async (
    input: CreateCrossSellAccountRequest
  ): Promise<string | null> => {
    const crossSellAccountId = uuidv7();

    const result = await this.db
      .insert(planCrossSellAccount)
      .values({
        plan_cross_sell_account_id: crossSellAccountId,
        plan_cross_sell_id: input.plan_cross_sell_id,
        account_id: input.account_id,
      })
      .execute();

    if (!result) {
      return null;
    }

    return crossSellAccountId;
  };
}
