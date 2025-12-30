import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';
import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';

@injectable()
export class UpgradeDiscountCalculatorRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  calculateUpgradeDiscount = async (
    accountId: string,
    newPlanId: string,
    selectedBillingPeriod?: 'monthly' | 'annual'
  ): Promise<CalculateUpgradeDiscountResponse> => {
    const accountResult = await this.findAccountWithPlanAccounts(accountId);
    const activePlanAccount = this.findActivePlanAccount(accountResult);

    if (!activePlanAccount?.ppl) {
      return this.buildEmptyResponse();
    }

    if (
      !activePlanAccount.last_payment_date ||
      !activePlanAccount.next_payment_date
    ) {
      return this.buildEmptyResponse();
    }

    const now = new Date();
    const nextPaymentDate = new Date(activePlanAccount.next_payment_date);
    if (nextPaymentDate <= now) {
      return this.buildEmptyResponse();
    }

    const currentPlanValue = Number(activePlanAccount.value);
    let billingPeriodName: string | null = activePlanAccount.bpl?.name || null;

    if (!billingPeriodName) {
      billingPeriodName = calculateBillingPeriodByDates(
        activePlanAccount.last_payment_date,
        activePlanAccount.next_payment_date
      );
    }

    const newPlan = await this.getNewPlan(newPlanId);

    if (!newPlan) {
      return this.buildResponseWithoutDiscount(currentPlanValue, false);
    }

    const billingPeriodForNewPlan: string | null =
      selectedBillingPeriod || billingPeriodName || null;

    const currentPlanId = activePlanAccount.ppl.plan_id;
    const isSamePlan = currentPlanId === newPlanId;

    if (
      selectedBillingPeriod &&
      billingPeriodName !== selectedBillingPeriod &&
      isSamePlan
    ) {
      return this.buildResponseWithoutDiscount(currentPlanValue, false);
    }

    const newPlanPrice = this.getNewPlanPrice(
      {
        price: Number(newPlan.price),
        annual_discount: newPlan.annual_discount,
      },
      billingPeriodForNewPlan
    );

    const currentPlanMonthlyPrice = Number(activePlanAccount.ppl.price);

    let currentPlanPriceForComparison: number;
    if (billingPeriodForNewPlan === 'annual') {
      currentPlanPriceForComparison = currentPlanMonthlyPrice * 12;
    } else {
      currentPlanPriceForComparison = currentPlanMonthlyPrice;
    }

    const isUpgrade = this.isUpgrade(
      newPlanPrice,
      currentPlanPriceForComparison
    );

    if (!isUpgrade) {
      return this.buildResponseWithoutDiscount(currentPlanValue, false);
    }

    const dateCalculations = this.calculateDays(
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date
    );

    if (!this.isValidForDiscount(dateCalculations)) {
      return {
        discount: 0,
        current_plan_price: currentPlanValue,
        days_used: dateCalculations.daysUsed,
        days_remaining: dateCalculations.daysRemaining,
        total_days: dateCalculations.totalDays,
        is_upgrade: isUpgrade,
      };
    }

    const discount = this.calculateDiscountAmount(
      currentPlanValue,
      dateCalculations.totalDays,
      dateCalculations.daysRemaining
    );

    return {
      discount: Math.max(0, discount),
      current_plan_price: currentPlanValue,
      days_used: Math.max(0, dateCalculations.daysUsed),
      days_remaining: Math.max(0, dateCalculations.daysRemaining),
      total_days: Math.max(0, dateCalculations.totalDays),
      is_upgrade: isUpgrade,
    };
  };

  private readonly getNewPlan = async (newPlanId: string) => {
    return this.dbRo.query.plan.findFirst({
      where: and(
        eq(schema.plan.plan_id, newPlanId),
        isNull(schema.plan.deleted_at)
      ),
      columns: {
        plan_id: true,
        price: true,
        annual_discount: true,
      },
    });
  };

  private readonly getNewPlanPrice = (
    newPlan: { price: number; annual_discount: string | null },
    billingPeriodName: string | null
  ): number => {
    const monthlyPrice = Number(newPlan.price);

    if (billingPeriodName === 'annual') {
      const annualPrice = monthlyPrice * 12;
      if (newPlan.annual_discount) {
        const discount = Number.parseFloat(newPlan.annual_discount);
        return annualPrice * (1 - discount / 100);
      }
      return annualPrice;
    }

    return monthlyPrice;
  };

  private readonly isUpgrade = (
    newPlanPrice: number,
    currentPlanPrice: number
  ): boolean => {
    return newPlanPrice > currentPlanPrice;
  };

  private readonly calculateDays = (
    lastPaymentDate: string,
    nextPaymentDate: string
  ) => {
    const now = new Date();
    const lastDate = new Date(lastPaymentDate);
    const nextDate = new Date(nextPaymentDate);

    const totalDays = Math.ceil(
      (nextDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const daysUsed = Math.max(
      0,
      Math.ceil((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const daysRemaining = Math.max(
      0,
      Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      totalDays,
      daysUsed,
      daysRemaining,
    };
  };

  private readonly isValidForDiscount = (dateCalculations: {
    totalDays: number;
    daysRemaining: number;
  }): boolean => {
    return dateCalculations.daysRemaining > 0 && dateCalculations.totalDays > 0;
  };

  private readonly calculateDiscountAmount = (
    currentPlanPrice: number,
    totalDays: number,
    daysRemaining: number
  ): number => {
    const pricePerDay = currentPlanPrice / totalDays;
    const discount = pricePerDay * daysRemaining;

    return Math.round(discount * 100) / 100;
  };

  private readonly buildEmptyResponse =
    (): CalculateUpgradeDiscountResponse => {
      return {
        discount: 0,
        current_plan_price: 0,
        days_used: 0,
        days_remaining: 0,
        total_days: 0,
        is_upgrade: false,
      };
    };

  private readonly buildResponseWithoutDiscount = (
    currentPlanPrice: number,
    isUpgrade: boolean
  ): CalculateUpgradeDiscountResponse => {
    return {
      discount: 0,
      current_plan_price: currentPlanPrice,
      days_used: 0,
      days_remaining: 0,
      total_days: 0,
      is_upgrade: isUpgrade,
    };
  };

  private readonly findAccountWithPlanAccounts = async (accountId: string) => {
    return this.dbRo.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
            last_payment_date: true,
            value: true,
            billing_period_id: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
                price: true,
              },
            },
            bpl: {
              columns: {
                billing_period_id: true,
                name: true,
              },
            },
          },
        },
      },
      columns: {
        account_id: true,
      },
    });
  };

  private readonly findActivePlanAccount = (
    accountResult: Awaited<
      ReturnType<typeof this.findAccountWithPlanAccounts>
    > | null
  ) => {
    if (!accountResult?.apc) {
      return null;
    }

    const now = new Date();
    return accountResult.apc.find((pa) => {
      if (!pa.next_payment_date) {
        return false;
      }
      const nextPaymentDate = new Date(pa.next_payment_date);
      return nextPaymentDate > now;
    });
  };
}
