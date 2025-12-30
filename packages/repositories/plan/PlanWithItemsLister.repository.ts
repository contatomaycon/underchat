import * as schema from '@core/models';
import {
  plan,
  planItems,
  planProduct,
  planProductDescription,
  planAccountExclusive,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, isNull, asc, and, or, inArray } from 'drizzle-orm';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

@injectable()
export class PlanWithItemsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listPlanWithItems = async (
    accountId: string | null
  ): Promise<ListPlanWithItemsResponse[]> => {
    const plans = await this.listAllPlans(accountId || '');

    if (!plans.length) {
      return [];
    }

    const allItems = await this.listAllPlanItems();
    const itemsByPlanId = this.groupItemsByPlanId(allItems);
    const result = this.combinePlansWithItems(plans, itemsByPlanId);

    return result;
  };

  private readonly listAllPlans = async (accountId: string) => {
    const exclusivePlanIds = await this.getExclusivePlanIds(accountId);

    const whereConditions = [
      isNull(plan.deleted_at),
      eq(plan.status, EPlanStatus.active),
      this.buildExclusivePlanFilter(exclusivePlanIds),
    ];

    return this.dbRo
      .select({
        plan_id: plan.plan_id,
        name: plan.name,
        price: plan.price,
        price_old: plan.price_old,
        description: plan.description,
        annual_discount: plan.annual_discount,
        icon: plan.icon,
        is_test: plan.is_test,
        days_trial: plan.days_trial,
        is_exclusive: plan.is_exclusive,
        status: plan.status,
        created_at: plan.created_at,
      })
      .from(plan)
      .where(and(...whereConditions))
      .orderBy(asc(plan.price))
      .execute();
  };

  private readonly buildExclusivePlanFilter = (exclusivePlanIds: string[]) => {
    if (exclusivePlanIds.length === 0) {
      return eq(plan.is_exclusive, false);
    }

    const exclusiveCondition = or(
      eq(plan.is_exclusive, false),
      and(eq(plan.is_exclusive, true), inArray(plan.plan_id, exclusivePlanIds))
    );

    if (exclusiveCondition) {
      return exclusiveCondition;
    }

    return eq(plan.is_exclusive, false);
  };

  private readonly getExclusivePlanIds = async (
    accountId: string
  ): Promise<string[]> => {
    if (!accountId) {
      return [];
    }

    const result = await this.dbRo
      .select({
        plan_id: planAccountExclusive.plan_id,
      })
      .from(planAccountExclusive)
      .where(eq(planAccountExclusive.account_id, accountId))
      .execute();

    return result.map((item) => item.plan_id);
  };

  private readonly listAllPlanItems = async () => {
    return this.dbRo
      .select({
        plan_item_id: planItems.plan_item_id,
        plan_id: planItems.plan_id,
        plan_product_id: planItems.plan_product_id,
        quantity: planItems.quantity,
        created_at: planItems.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProductDescription.name,
          description: planProductDescription.description,
        },
      })
      .from(planItems)
      .innerJoin(
        planProduct,
        eq(planItems.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(isNull(planItems.deleted_at))
      .execute();
  };

  private readonly groupItemsByPlanId = (
    allItems: Awaited<ReturnType<typeof this.listAllPlanItems>>
  ): Map<string, ListPlanItemResponse[]> => {
    const itemsByPlanId = new Map<string, ListPlanItemResponse[]>();

    for (const item of allItems) {
      const planId = item.plan_id;
      if (!itemsByPlanId.has(planId)) {
        itemsByPlanId.set(planId, []);
      }
      const planItems = itemsByPlanId.get(planId);
      if (planItems) {
        planItems.push({
          plan_item_id: item.plan_item_id,
          plan_id: item.plan_id,
          plan_product_id: item.plan_product_id,
          quantity: item.quantity,
          created_at: item.created_at,
          plan_product: item.plan_product?.plan_product_id
            ? {
                plan_product_id: item.plan_product.plan_product_id,
                name: item.plan_product.name ?? null,
                description: item.plan_product.description ?? null,
              }
            : undefined,
        });
      }
    }

    return itemsByPlanId;
  };

  private readonly combinePlansWithItems = (
    plans: Awaited<ReturnType<typeof this.listAllPlans>>,
    itemsByPlanId: Map<string, ListPlanItemResponse[]>
  ): ListPlanWithItemsResponse[] => {
    return plans.map((p) => ({
      plan_id: p.plan_id,
      name: p.name,
      price: Number(p.price),
      price_old: Number(p.price_old),
      description: p.description ?? null,
      annual_discount: p.annual_discount ?? null,
      icon: p.icon ?? null,
      is_test: p.is_test,
      days_trial: p.days_trial ? Number(p.days_trial) : null,
      is_exclusive: p.is_exclusive,
      status: p.status,
      created_at: p.created_at,
      plan_items: itemsByPlanId.get(p.plan_id) ?? [],
    }));
  };
}
