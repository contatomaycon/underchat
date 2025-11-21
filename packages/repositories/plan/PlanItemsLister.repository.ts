import * as schema from '@core/models';
import { planItems, planProduct } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, isNull, and } from 'drizzle-orm';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';

@injectable()
export class PlanItemsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPlanItems = async (planId: string): Promise<ListPlanItemResponse[]> => {
    const result = await this.db
      .select({
        plan_item_id: planItems.plan_item_id,
        plan_id: planItems.plan_id,
        plan_product_id: planItems.plan_product_id,
        quantity: planItems.quantity,
        created_at: planItems.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProduct.name,
        },
      })
      .from(planItems)
      .leftJoin(
        planProduct,
        eq(planItems.plan_product_id, planProduct.plan_product_id)
      )
      .where(and(eq(planItems.plan_id, planId), isNull(planItems.deleted_at)))
      .execute();

    if (!result.length) {
      return [] as ListPlanItemResponse[];
    }

    const items: ListPlanItemResponse[] = result.map((item) => ({
      plan_item_id: item.plan_item_id,
      plan_id: item.plan_id,
      plan_product_id: item.plan_product_id,
      quantity: item.quantity,
      created_at: item.created_at,
      plan_product: item.plan_product?.plan_product_id
        ? {
            plan_product_id: item.plan_product.plan_product_id,
            name: item.plan_product.name,
          }
        : undefined,
    }));

    return items;
  };
}
