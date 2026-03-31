import * as schema from '@core/models';
import {
  plan,
  planCrossSell,
  planAccount,
  accountPayment,
  accountPaymentCrossSell,
  planAccountExclusive,
  billingPeriod,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull, gt, sql } from 'drizzle-orm';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { UpgradeDiscountCalculatorRepository } from './UpgradeDiscountCalculator.repository';
import { randomUUID } from 'node:crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';

@injectable()
export class OrderPaymentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(UpgradeDiscountCalculatorRepository)
    private readonly upgradeDiscountCalculator: UpgradeDiscountCalculatorRepository
  ) {}

  private readonly roundTo2 = (value: number): number => {
    return Math.round(value * 100) / 100;
  };

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

    if (newPlan.status !== EPlanStatus.active) {
      throw new Error('Plano não está disponível');
    }

    if (newPlan.is_exclusive) {
      const hasExclusiveAccess = await this.checkExclusivePlanAccess(
        accountId,
        input.plan_id
      );
      if (!hasExclusiveAccess) {
        throw new Error('Plano exclusivo não disponível para esta conta');
      }
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
      input.addons?.map((a) => a.plan_cross_sell_id) || [],
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
    isAddonOnly: boolean;
    userCardId?: string | null;
    installment?: string | null;
    boleto?: string | null;
    boletoNumber?: string | null;
    boletoPdf?: string | null;
  }): Promise<string> => {
    const accountPaymentId = randomUUID();

    await this.dbRw.insert(accountPayment).values({
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
      is_addon_only: data.isAddonOnly,
      release_status: EAccountPaymentReleaseStatus.pending,
      user_card_id: data.userCardId || null,
      installment: data.installment || null,
      boleto: data.boleto || null,
      boleto_number: data.boletoNumber || null,
      boleto_pdf: data.boletoPdf || null,
    });

    return accountPaymentId;
  };

  createAccountPaymentCrossSells = async (data: {
    accountPaymentId: string;
    addons: Array<{ plan_cross_sell_id: string; value?: number }>;
    billingPeriod: 'monthly' | 'annual';
  }): Promise<void> => {
    if (!data.addons || data.addons.length === 0) {
      return;
    }

    const crossSellIds = data.addons.map((a) => a.plan_cross_sell_id);

    const crossSells = await this.dbRw
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
      })
      .from(planCrossSell)
      .where(
        and(
          inArray(planCrossSell.plan_cross_sell_id, crossSellIds),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    const crossSellMap = new Map(
      crossSells.map((crossSell) => [crossSell.plan_cross_sell_id, crossSell])
    );
    const multiplier = data.billingPeriod === 'annual' ? 12 : 1;
    const crossSellRecords: Array<{
      account_payment_cross_sell_id: string;
      plan_cross_sell_id: string;
      account_payment_id: string;
      quantity: number;
      value: string;
      created_at: string;
      updated_at: string;
    }> = [];

    for (const addon of data.addons) {
      const crossSell = crossSellMap.get(addon.plan_cross_sell_id);
      if (!crossSell) {
        continue;
      }

      const totalValue =
        addon.value !== undefined
          ? this.roundTo2(addon.value)
          : this.roundTo2(Number(crossSell.price) * multiplier);

      crossSellRecords.push({
        account_payment_cross_sell_id: randomUUID(),
        plan_cross_sell_id: crossSell.plan_cross_sell_id,
        account_payment_id: data.accountPaymentId,
        quantity: crossSell.quantity,
        value: totalValue.toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (crossSellRecords.length > 0) {
      await this.dbRw.insert(accountPaymentCrossSell).values(crossSellRecords);
    }
  };

  getPlan = async (planId: string) => {
    return this.dbRo.query.plan.findFirst({
      where: and(eq(plan.plan_id, planId), isNull(plan.deleted_at)),
      columns: {
        plan_id: true,
        price: true,
        annual_discount: true,
        is_test: true,
        days_trial: true,
        status: true,
        is_exclusive: true,
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
    planCrossSellIds: string[],
    billingPeriod: 'monthly' | 'annual'
  ): Promise<number> => {
    if (!planCrossSellIds || planCrossSellIds.length === 0) {
      return 0;
    }

    const crossSells = await this.dbRw
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
      })
      .from(planCrossSell)
      .where(
        and(
          inArray(planCrossSell.plan_cross_sell_id, planCrossSellIds),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    const crossSellCountMap = new Map<string, number>();
    for (const planCrossSellId of planCrossSellIds) {
      const count = crossSellCountMap.get(planCrossSellId) || 0;
      crossSellCountMap.set(planCrossSellId, count + 1);
    }

    const multiplier = billingPeriod === 'annual' ? 12 : 1;

    return crossSells.reduce((total, crossSell) => {
      const count = crossSellCountMap.get(crossSell.plan_cross_sell_id) || 0;
      const addonValue = Number(crossSell.price) * multiplier * count;
      return total + this.roundTo2(addonValue);
    }, 0);
  };

  getBillingPeriodId = (billingPeriod: 'monthly' | 'annual'): string | null => {
    const billingPeriodMap: Record<'monthly' | 'annual', string> = {
      monthly: EBillingPeriod.monthly,
      annual: EBillingPeriod.annual,
    };

    return billingPeriodMap[billingPeriod] || null;
  };

  getCurrentActivePlanAccount = async (accountId: string) => {
    const result = await this.dbRo
      .select({
        plan_id: planAccount.plan_id,
        billing_period_id: planAccount.billing_period_id,
        billing_period_name: billingPeriod.name,
        recurring_payment: planAccount.recurring_payment,
        last_payment_date: planAccount.last_payment_date,
        next_payment_date: planAccount.next_payment_date,
      })
      .from(planAccount)
      .leftJoin(
        billingPeriod,
        eq(planAccount.billing_period_id, billingPeriod.billing_period_id)
      )
      .where(
        and(
          eq(planAccount.account_id, accountId),
          gt(planAccount.next_payment_date, sql`NOW()`)
        )
      )
      .orderBy(sql`${planAccount.updated_at} DESC`)
      .limit(1)
      .execute();

    const row = result[0];

    if (!row) {
      return null;
    }

    const billingPeriodName =
      row.billing_period_name === 'annual'
        ? 'annual'
        : row.billing_period_name === 'monthly'
          ? 'monthly'
          : row.billing_period_id === EBillingPeriod.annual
            ? 'annual'
            : row.billing_period_id === EBillingPeriod.monthly
              ? 'monthly'
              : null;

    return {
      plan_id: row.plan_id,
      billing_period_id: row.billing_period_id,
      billing_period: billingPeriodName,
      recurring_payment: row.recurring_payment,
      last_payment_date: row.last_payment_date,
      next_payment_date: row.next_payment_date,
    };
  };

  private readonly checkExclusivePlanAccess = async (
    accountId: string,
    planId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .select({
        plan_account_exclusive_id:
          planAccountExclusive.plan_account_exclusive_id,
      })
      .from(planAccountExclusive)
      .where(
        and(
          eq(planAccountExclusive.account_id, accountId),
          eq(planAccountExclusive.plan_id, planId)
        )
      )
      .execute();

    return result.length > 0;
  };
}
