import * as schema from '@core/models';
import { plan, planCrossSell, accountPayment, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { UpgradeDiscountCalculatorRepository } from './UpgradeDiscountCalculator.repository';
import { randomUUID } from 'crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';

@injectable()
export class OrderPaymentCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    @inject(UpgradeDiscountCalculatorRepository)
    private readonly upgradeDiscountCalculator: UpgradeDiscountCalculatorRepository
  ) {}

  calculateOrderPayment = async (
    accountId: string,
    input: CreateOrderPaymentRequest
  ): Promise<{
    planPrice: number;
    addonsTotal: number;
    discountAmount: number;
    totalAmount: number;
  }> => {
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

    return {
      planPrice,
      addonsTotal,
      discountAmount,
      totalAmount,
    };
  };

  createAccountPayment = async (data: {
    accountId: string;
    userCustomerId: string;
    planId: string;
    billing: string;
    paymentBillingTypeId: string;
    value: string;
    netValue: string;
    pixTransaction: string | null;
    paymentStatusId: string;
    billingPeriodId: string | null;
    invoiceUrl: string | null;
    recurringPayment: boolean;
  }): Promise<string> => {
    const accountPaymentId = randomUUID();

    await this.db.insert(accountPayment).values({
      account_payment_id: accountPaymentId,
      account_id: data.accountId,
      user_customer_id: data.userCustomerId,
      plan_id: data.planId,
      billing: data.billing,
      payment_billing_type_id: data.paymentBillingTypeId,
      value: data.value,
      net_value: data.netValue,
      pix_transaction: data.pixTransaction,
      payment_status_id: data.paymentStatusId,
      billing_period_id: data.billingPeriodId,
      invoice_url: data.invoiceUrl,
      recurring_payment: data.recurringPayment,
    });

    return accountPaymentId;
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

    if (billingPeriodName !== 'annual') {
      return monthlyPrice;
    }

    const annualPrice = monthlyPrice * 12;
    if (!planData.annual_discount) {
      return annualPrice;
    }

    const discount = Number.parseFloat(planData.annual_discount);
    return annualPrice * (1 - discount / 100);
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
      if (!crossSell) {
        return total;
      }
      return total + Number(crossSell.price) * addon.quantity * multiplier;
    }, 0);
  };

  getBillingPeriodId = (billingPeriod: 'monthly' | 'annual'): string | null => {
    const billingPeriodMap: Record<'monthly' | 'annual', string> = {
      monthly: EBillingPeriod.monthly,
      annual: EBillingPeriod.annual,
    };

    return billingPeriodMap[billingPeriod] || null;
  };
}
