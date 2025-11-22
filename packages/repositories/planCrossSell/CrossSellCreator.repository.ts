import * as schema from '@core/models';
import { planCrossSell } from '@core/models';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class CrossSellCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createCrossSell = async (
    input: CreateCrossSellRequest
  ): Promise<string | null> => {
    const crossSellId = uuidv7();

    const result = await this.db
      .insert(planCrossSell)
      .values({
        plan_cross_sell_id: crossSellId,
        plan_product_id: input.plan_product_id,
        quantity: input.quantity,
        price: input.price.toString(),
      })
      .execute();

    if (!result) {
      return null;
    }

    return crossSellId;
  };
}
