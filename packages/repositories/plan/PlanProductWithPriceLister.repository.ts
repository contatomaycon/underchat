import * as schema from '@core/models';
import {
  planProduct,
  planProductDescription,
  planCrossSell,
} from '@core/models';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, isNull } from 'drizzle-orm';

@injectable()
export class PlanProductWithPriceListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listPlanProductWithPrice = async (): Promise<
    ListPlanProductWithPriceResponse[]
  > => {
    const products = await this.listAllProducts();

    if (!products.length) {
      return [];
    }

    const priceMap = await this.buildPriceMap();

    return this.combineProductsWithPrices(products, priceMap);
  };

  private readonly listAllProducts = async () => {
    return this.dbRo
      .select({
        plan_product_id: planProduct.plan_product_id,
        name: planProductDescription.name,
        description: planProductDescription.description,
      })
      .from(planProduct)
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .execute();
  };

  private readonly buildPriceMap = async (): Promise<Map<string, number>> => {
    const crossSells = await this.dbRo
      .select({
        plan_product_id: planCrossSell.plan_product_id,
        price: planCrossSell.price,
      })
      .from(planCrossSell)
      .where(isNull(planCrossSell.deleted_at))
      .execute();

    const priceMap = new Map<string, number>();
    for (const cs of crossSells) {
      if (!priceMap.has(cs.plan_product_id)) {
        priceMap.set(cs.plan_product_id, Number(cs.price));
      }
    }

    return priceMap;
  };

  private readonly combineProductsWithPrices = (
    products: Array<{
      plan_product_id: string;
      name: string | null;
      description: string | null;
    }>,
    priceMap: Map<string, number>
  ): ListPlanProductWithPriceResponse[] => {
    return products.map((product) => ({
      plan_product_id: product.plan_product_id,
      name: product.name ?? null,
      description: product.description ?? null,
      price: priceMap.get(product.plan_product_id) ?? null,
    }));
  };
}
