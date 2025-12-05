import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';

@injectable()
export class UpgradeDiscountCalculatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  calculateUpgradeDiscount = async (
    accountId: string,
    newPlanId: string
  ): Promise<CalculateUpgradeDiscountResponse> => {
    const activePlanAccount = await this.getActivePlanAccount(accountId);

    if (!activePlanAccount?.ppl) {
      return this.buildEmptyResponse();
    }

    const currentPlanPrice = Number(activePlanAccount.ppl.price);
    const newPlan = await this.getNewPlan(newPlanId);

    if (!newPlan) {
      return this.buildResponseWithoutDiscount(currentPlanPrice, false);
    }

    const newPlanPrice = Number(newPlan.price);
    const isUpgrade = this.isUpgrade(newPlanPrice, currentPlanPrice);

    if (!isUpgrade) {
      return this.buildResponseWithoutDiscount(currentPlanPrice, false);
    }

    const dateCalculations = this.calculateDays(
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date
    );

    if (!this.isValidForDiscount(dateCalculations)) {
      return {
        discount: 0,
        current_plan_price: currentPlanPrice,
        days_used: dateCalculations.daysUsed,
        days_remaining: dateCalculations.daysRemaining,
        total_days: dateCalculations.totalDays,
        is_upgrade: isUpgrade,
      };
    }

    const discount = this.calculateDiscountAmount(
      currentPlanPrice,
      dateCalculations.totalDays,
      dateCalculations.daysRemaining
    );

    return {
      discount: Math.max(0, discount),
      current_plan_price: currentPlanPrice,
      days_used: Math.max(0, dateCalculations.daysUsed),
      days_remaining: Math.max(0, dateCalculations.daysRemaining),
      total_days: Math.max(0, dateCalculations.totalDays),
      is_upgrade: isUpgrade,
    };
  };

  private readonly getActivePlanAccount = async (accountId: string) => {
    const accountResult = await this.findAccountWithPlanAccounts(accountId);
    return this.findActivePlanAccount(accountResult);
  };

  private readonly getNewPlan = async (newPlanId: string) => {
    return this.db.query.plan.findFirst({
      where: and(
        eq(schema.plan.plan_id, newPlanId),
        isNull(schema.plan.deleted_at)
      ),
      columns: {
        plan_id: true,
        price: true,
      },
    });
  };

  private readonly isUpgrade = (
    newPlanPrice: number,
    currentPlanPrice: number
  ): boolean => {
    return newPlanPrice > currentPlanPrice;
  };

  private readonly calculateDays = (
    lastPaymentDate: string | null,
    nextPaymentDate: string | null
  ) => {
    const now = new Date();
    const lastDate = lastPaymentDate ? new Date(lastPaymentDate) : now;
    const nextDate = nextPaymentDate ? new Date(nextPaymentDate) : now;

    const totalDays = Math.ceil(
      (nextDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const daysUsed = Math.ceil(
      (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
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
    return pricePerDay * daysRemaining;
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
    return this.db.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
            last_payment_date: true,
          },
          with: {
            pas: {
              columns: {
                plan_account_status_id: true,
                name: true,
              },
            },
            ppl: {
              columns: {
                plan_id: true,
                price: true,
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

  private readonly findActivePlanAccount = (accountResult: any) => {
    return accountResult?.apc?.find((pa: any) => pa.pas?.name === 'active');
  };
}
