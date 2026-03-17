import * as schema from '@core/models';
import {
  planCrossSell,
  planCrossSellAccount,
  planAccount,
  planProduct,
  planProductDescription,
  billingPeriod,
  planItems,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  gt,
  isNull,
  SQLWrapper,
  or,
  ilike,
  sql,
} from 'drizzle-orm';
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { ListCrossSellResponse } from '@core/schema/planCrossSell/listCrossSell/response.schema';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';

@injectable()
export class CrossSellListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersCrossSell = (
    query: ListCrossSellRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.product_name || query.price) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.product_name
          ? ilike(planProductDescription.name, `%${query.product_name}%`)
          : undefined,
        query.price
          ? ilike(sql`CAST(${planCrossSell.price} AS TEXT)`, `%${query.price}%`)
          : undefined,
      ];

      const filteredConditions = conditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    return filters;
  };

  listCrossSells = async (
    perPage: number,
    currentPage: number,
    query: ListCrossSellRequest
  ): Promise<ListCrossSellResponse[]> => {
    const filtersCrossSell = this.setFiltersCrossSell(query);

    const result = await this.dbRo
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        plan_product_id: planCrossSell.plan_product_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
        created_at: planCrossSell.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProductDescription.name,
          description: planProductDescription.description,
        },
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(
        and(
          ...(filtersCrossSell.length > 0 ? filtersCrossSell : []),
          isNull(planCrossSell.deleted_at)
        )
      )
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result.length) {
      return [] as ListCrossSellResponse[];
    }

    const crossSells: ListCrossSellResponse[] = result.map((item) => ({
      plan_cross_sell_id: item.plan_cross_sell_id,
      plan_product_id: item.plan_product_id,
      quantity: item.quantity,
      price: Number(item.price),
      created_at: item.created_at,
      plan_product: item.plan_product?.plan_product_id
        ? {
            plan_product_id: item.plan_product.plan_product_id,
            name: item.plan_product.name ?? null,
            description: item.plan_product.description ?? null,
          }
        : undefined,
    }));

    return crossSells;
  };

  listCrossSellsTotal = async (
    query: ListCrossSellRequest
  ): Promise<number> => {
    const filtersCrossSell = this.setFiltersCrossSell(query);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(
        and(
          ...(filtersCrossSell.length > 0 ? filtersCrossSell : []),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };

  private readonly roundTo2 = (value: number): number => {
    return Math.round(value * 100) / 100;
  };

  private readonly calculateCycleData = (
    lastPaymentDate: string | null,
    nextPaymentDate: string | null
  ) => {
    if (!lastPaymentDate || !nextPaymentDate) {
      return {
        totalDays: 0,
        daysRemaining: 0,
        ratio: 1,
      };
    }

    const lastDate = new Date(lastPaymentDate);
    const nextDate = new Date(nextPaymentDate);
    const now = new Date();

    const totalDays = Math.max(
      0,
      Math.ceil(
        (nextDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    );

    const daysRemaining = Math.max(
      0,
      Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    const ratio =
      totalDays > 0 && daysRemaining > 0 ? daysRemaining / totalDays : 0;

    return {
      totalDays,
      daysRemaining,
      ratio,
    };
  };

  listAvailableCrossSells = async (input?: {
    accountId?: string;
    pricingMode?: 'full' | 'proportional';
  }): Promise<ListAvailableCrossSellResponse[]> => {
    const result = await this.dbRo
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        plan_product_id: planCrossSell.plan_product_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
        created_at: planCrossSell.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProductDescription.name,
          description: planProductDescription.description,
        },
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(isNull(planCrossSell.deleted_at))
      .execute();

    if (!result.length) {
      return [] as ListAvailableCrossSellResponse[];
    }

    if (!input?.accountId) {
      return result.map((item) => ({
        plan_cross_sell_id: item.plan_cross_sell_id,
        plan_product_id: item.plan_product_id,
        quantity: item.quantity,
        price: Number(item.price),
        price_per_cycle: Number(item.price),
        price_proportional: Number(item.price),
        billing_period: null,
        days_remaining: 0,
        total_days: 0,
        active_quantity: 0,
        renewable_quantity: 0,
        active_instances: 0,
        renewable_instances: 0,
        is_single_use: item.plan_product_id === EPlanProduct.personalization,
        can_purchase: true,
        created_at: item.created_at,
        plan_product: item.plan_product?.plan_product_id
          ? {
              plan_product_id: item.plan_product.plan_product_id,
              name: item.plan_product.name ?? null,
              description: item.plan_product.description ?? null,
            }
          : undefined,
      }));
    }

    const [activePlanAccount, accountCrossSells] = await Promise.all([
      this.dbRo
        .select({
          plan_id: planAccount.plan_id,
          billing_period_id: planAccount.billing_period_id,
          billing_period_name: billingPeriod.name,
          next_payment_date: planAccount.next_payment_date,
          last_payment_date: planAccount.last_payment_date,
        })
        .from(planAccount)
        .leftJoin(
          billingPeriod,
          eq(planAccount.billing_period_id, billingPeriod.billing_period_id)
        )
        .where(
          and(
            eq(planAccount.account_id, input.accountId),
            gt(planAccount.next_payment_date, sql`NOW()`)
          )
        )
        .orderBy(sql`${planAccount.updated_at} DESC`)
        .limit(1)
        .execute(),
      this.dbRo
        .select({
          plan_cross_sell_account_id:
            planCrossSellAccount.plan_cross_sell_account_id,
          plan_cross_sell_id: planCrossSellAccount.plan_cross_sell_id,
          cancellation_date: planCrossSellAccount.cancellation_date,
          deleted_at: planCrossSellAccount.deleted_at,
        })
        .from(planCrossSellAccount)
        .where(
          and(
            eq(planCrossSellAccount.account_id, input.accountId),
            isNull(planCrossSellAccount.deleted_at)
          )
        )
        .execute(),
    ]);

    const planAccountData = activePlanAccount[0] || null;
    const activePlanItems = planAccountData?.plan_id
      ? await this.dbRo
          .select({
            plan_product_id: planItems.plan_product_id,
            quantity: planItems.quantity,
          })
          .from(planItems)
          .where(
            and(
              eq(planItems.plan_id, planAccountData.plan_id),
              isNull(planItems.deleted_at)
            )
          )
          .execute()
      : [];
    const billingNameRaw = planAccountData?.billing_period_name || null;
    const billingPeriodName: 'monthly' | 'annual' | null =
      billingNameRaw === 'annual'
        ? 'annual'
        : billingNameRaw === 'monthly'
          ? 'monthly'
          : planAccountData?.billing_period_id === EBillingPeriod.annual
            ? 'annual'
            : planAccountData?.billing_period_id === EBillingPeriod.monthly
              ? 'monthly'
              : null;

    const cycle = this.calculateCycleData(
      planAccountData?.last_payment_date || null,
      planAccountData?.next_payment_date || null
    );
    const pricingMode = input.pricingMode || 'full';
    const requiresActivePlan = pricingMode === 'proportional';
    const multiplier = billingPeriodName === 'annual' ? 12 : 1;
    const canUseProportional =
      pricingMode === 'proportional' &&
      billingPeriodName !== null &&
      cycle.totalDays > 0 &&
      cycle.daysRemaining > 0;

    const activeInstancesMap = new Map<string, number>();
    const renewableInstancesMap = new Map<string, number>();
    const activeProductQuantityMap = new Map<string, number>();
    const planProductQuantityMap = new Map<string, number>();

    const crossSellById = new Map(
      result.map((item) => [item.plan_cross_sell_id, item])
    );

    for (const accountCrossSell of accountCrossSells) {
      const crossSell = crossSellById.get(accountCrossSell.plan_cross_sell_id);
      if (!crossSell) {
        continue;
      }

      const quantity = crossSell.quantity;
      const currentActiveInstances =
        activeInstancesMap.get(accountCrossSell.plan_cross_sell_id) || 0;
      activeInstancesMap.set(
        accountCrossSell.plan_cross_sell_id,
        currentActiveInstances + 1
      );

      const currentActiveProductQty =
        activeProductQuantityMap.get(crossSell.plan_product_id) || 0;
      activeProductQuantityMap.set(
        crossSell.plan_product_id,
        currentActiveProductQty + quantity
      );

      if (accountCrossSell.cancellation_date) {
        continue;
      }

      const currentRenewableInstances =
        renewableInstancesMap.get(accountCrossSell.plan_cross_sell_id) || 0;
      renewableInstancesMap.set(
        accountCrossSell.plan_cross_sell_id,
        currentRenewableInstances + 1
      );
    }

    for (const planItem of activePlanItems) {
      const currentPlanQty =
        planProductQuantityMap.get(planItem.plan_product_id) || 0;
      planProductQuantityMap.set(
        planItem.plan_product_id,
        currentPlanQty + Number(planItem.quantity || 0)
      );
    }

    const crossSells: ListAvailableCrossSellResponse[] = result.map((item) => {
      const basePrice = Number(item.price);
      const fullPrice = this.roundTo2(basePrice * multiplier);
      const proportionalPrice = canUseProportional
        ? this.roundTo2(fullPrice * cycle.ratio)
        : fullPrice;
      const activeInstances =
        activeInstancesMap.get(item.plan_cross_sell_id) || 0;
      const renewableInstances =
        renewableInstancesMap.get(item.plan_cross_sell_id) || 0;
      const activeQuantity = this.roundTo2(activeInstances * item.quantity);
      const renewableQuantity = this.roundTo2(
        renewableInstances * item.quantity
      );
      const isSingleUse = item.plan_product_id === EPlanProduct.personalization;
      const activeAddonQty =
        activeProductQuantityMap.get(item.plan_product_id) || 0;
      const activePlanQty =
        planProductQuantityMap.get(item.plan_product_id) || 0;
      const hasSingleUseActive = activeAddonQty + activePlanQty > 0;
      const hasActivePlan = planAccountData !== null;
      const canPurchaseBase = requiresActivePlan ? hasActivePlan : true;
      const canPurchase =
        canPurchaseBase && (!isSingleUse || !hasSingleUseActive);

      return {
        plan_cross_sell_id: item.plan_cross_sell_id,
        plan_product_id: item.plan_product_id,
        quantity: item.quantity,
        price: basePrice,
        price_per_cycle: fullPrice,
        price_proportional: proportionalPrice,
        billing_period: billingPeriodName,
        days_remaining: cycle.daysRemaining,
        total_days: cycle.totalDays,
        active_quantity: activeQuantity,
        renewable_quantity: renewableQuantity,
        active_instances: activeInstances,
        renewable_instances: renewableInstances,
        is_single_use: isSingleUse,
        can_purchase: canPurchase,
        created_at: item.created_at,
        plan_product: item.plan_product?.plan_product_id
          ? {
              plan_product_id: item.plan_product.plan_product_id,
              name: item.plan_product.name ?? null,
              description: item.plan_product.description ?? null,
            }
          : undefined,
      };
    });

    return crossSells;
  };
}
