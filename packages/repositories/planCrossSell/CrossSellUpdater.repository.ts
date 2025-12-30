import * as schema from '@core/models';
import { planCrossSell } from '@core/models';
import { UpdateCrossSellRequest } from '@core/schema/planCrossSell/updateCrossSell/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class CrossSellUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateCrossSell = async (
    crossSellId: string,
    input: UpdateCrossSellRequest
  ): Promise<boolean> => {
    const result = await this.db
      .update(planCrossSell)
      .set({
        plan_product_id: input.plan_product_id ?? undefined,
        quantity: input.quantity ?? undefined,
        price: input.price?.toString() ?? undefined,
      })
      .where(eq(planCrossSell.plan_cross_sell_id, crossSellId))
      .execute();

    return result.rowCount === 1;
  };
}
