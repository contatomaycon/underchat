import * as schema from '@core/models';
import { plan, planCrossSell } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { UpgradeDiscountCalculatorRepository } from './UpgradeDiscountCalculator.repository';
import { randomUUID } from 'crypto';

@injectable()
export class OrderPaymentCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    @inject(UpgradeDiscountCalculatorRepository)
    private readonly upgradeDiscountCalculator: UpgradeDiscountCalculatorRepository
  ) {}

  createOrderPayment = async (
    accountId: string,
    input: CreateOrderPaymentRequest
  ): Promise<CreateOrderPaymentResponse> => {
    const newPlan = await this.getPlan(input.plan_id);
    if (!newPlan) {
      throw new Error('Plano não encontrado');
    }

    const planPrice = this.calculatePlanPrice(
      {
        price: Number(newPlan.price),
        annual_discount: newPlan.annual_discount,
      },
      input.billing_period
    );

    const upgradeDiscount =
      await this.upgradeDiscountCalculator.calculateUpgradeDiscount(
        accountId,
        input.plan_id,
        input.billing_period
      );

    const addonsTotal = await this.calculateAddonsTotal(
      input.addons || [],
      input.billing_period
    );

    const discountAmount = upgradeDiscount.is_upgrade
      ? upgradeDiscount.discount
      : 0;

    const totalAmount =
      Math.round(Math.max(0, planPrice + addonsTotal - discountAmount) * 100) /
      100;
    const orderId = randomUUID();

    return {
      order_id: orderId,
      total_amount: totalAmount,
      plan_price: planPrice,
      addons_total: addonsTotal,
      upgrade_discount: discountAmount,
      payment_method: input.payment_method,
    };
  };

  private readonly getPlan = async (planId: string) => {
    return this.db.query.plan.findFirst({
      where: and(eq(plan.plan_id, planId), isNull(plan.deleted_at)),
      columns: {
        plan_id: true,
        price: true,
        annual_discount: true,
      },
    });
  };

  private readonly calculatePlanPrice = (
    planData: { price: number; annual_discount: string | null },
    billingPeriodName: string | null
  ): number => {
    const monthlyPrice = Number(planData.price);

    if (billingPeriodName === 'annual') {
      const annualPrice = monthlyPrice * 12;
      if (planData.annual_discount) {
        const discount = Number.parseFloat(planData.annual_discount);
        return annualPrice * (1 - discount / 100);
      }
      return annualPrice;
    }

    return monthlyPrice;
  };

  private readonly calculateAddonsTotal = async (
    addons: Array<{ plan_product_id: string; quantity: number }>,
    billingPeriod: 'monthly' | 'annual'
  ): Promise<number> => {
    if (!addons || addons.length === 0) {
      return 0;
    }

    const addonIds = addons.map((a) => a.plan_product_id);

    const crossSells = await this.db
      .select({
        plan_product_id: planCrossSell.plan_product_id,
        price: planCrossSell.price,
      })
      .from(planCrossSell)
      .where(
        and(
          inArray(planCrossSell.plan_product_id, addonIds),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    const multiplier = billingPeriod === 'annual' ? 12 : 1;

    return addons.reduce((total, addon) => {
      const crossSell = crossSells.find(
        (cs) => cs.plan_product_id === addon.plan_product_id
      );
      if (!crossSell) return total;
      return total + Number(crossSell.price) * addon.quantity * multiplier;
    }, 0);
  };
}
