import * as schema from '@core/models';
import {
  account,
  accountPayment,
  planCrossSell,
  planCrossSellAccount,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';

@injectable()
export class PlanCurrentInvoiceViewerRepository {
  private readonly paidStatuses: string[] = [
    EPaymentStatus.received,
    EPaymentStatus.confirmed,
    EPaymentStatus.received_in_cash,
    EPaymentStatus.dunning_received,
  ];

  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly roundTo2 = (value: number): number => {
    return Math.round(value * 100) / 100;
  };

  viewCurrentPlanInvoice = async (
    accountId: string
  ): Promise<ViewCurrentPlanInvoiceResponse> => {
    const accountResult = await this.findAccountWithPlanAccounts(accountId);
    const activePlanAccount = this.findActivePlanAccount(accountResult);
    const planAccount =
      activePlanAccount || this.findMostRecentPlanAccount(accountResult);

    if (!planAccount?.ppl) {
      return this.buildEmptyResponse();
    }

    const billingPeriodValue = this.getBillingPeriod(
      planAccount.bpl?.name,
      planAccount.last_payment_date,
      planAccount.next_payment_date
    );
    const [lastPaidInvoiceValue, currentTotalCycleValue] = await Promise.all([
      this.findLastPaidInvoiceValue(accountId),
      this.findCurrentTotalCycleValue({
        accountId,
        planPrice: planAccount.ppl.price,
        annualDiscount: planAccount.ppl.annual_discount,
        isTestPlan: planAccount.ppl.is_test,
        billingPeriodValue,
      }),
    ]);

    return this.buildPlanInvoiceResponse({
      planData: planAccount.ppl,
      lastPaymentDate: planAccount.last_payment_date,
      nextPaymentDate: planAccount.next_payment_date,
      recurringPayment: planAccount.recurring_payment,
      cancellationDate: planAccount.cancellation_date,
      billingPeriodValue,
      planAccountValue: planAccount.value,
      lastPaidInvoiceValue,
      currentTotalCycleValue,
      accountStatusId: accountResult?.account_status_id || null,
    });
  };

  private readonly getBillingPeriodMultiplier = (
    billingPeriodValue: string | null
  ): number => {
    return billingPeriodValue === 'annual' ? 12 : 1;
  };

  private readonly calculateBasePlanCycleValue = (input: {
    planPrice: string;
    annualDiscount: string | null;
    isTestPlan: boolean | null;
    billingPeriodValue: string | null;
  }): number => {
    if (input.isTestPlan) {
      return 0;
    }

    const monthlyPrice = Number(input.planPrice);
    if (!Number.isFinite(monthlyPrice)) {
      return 0;
    }

    if (input.billingPeriodValue !== 'annual') {
      return this.roundTo2(monthlyPrice);
    }

    const annualPrice = monthlyPrice * 12;
    if (!input.annualDiscount) {
      return this.roundTo2(annualPrice);
    }

    const discount = Number.parseFloat(input.annualDiscount);
    if (!Number.isFinite(discount)) {
      return this.roundTo2(annualPrice);
    }

    return this.roundTo2(annualPrice * (1 - discount / 100));
  };

  private readonly findActiveAddonCycleTotal = async (input: {
    accountId: string;
    billingPeriodValue: string | null;
  }): Promise<number> => {
    const rows = await this.dbRo
      .select({
        price: planCrossSell.price,
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSell.plan_cross_sell_id,
          planCrossSellAccount.plan_cross_sell_id
        )
      )
      .where(
        and(
          eq(planCrossSellAccount.account_id, input.accountId),
          isNull(planCrossSellAccount.deleted_at),
          isNull(planCrossSellAccount.cancellation_date),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    const multiplier = this.getBillingPeriodMultiplier(
      input.billingPeriodValue
    );
    const total = rows.reduce((sum, item) => {
      return sum + Number(item.price || 0) * multiplier;
    }, 0);

    return this.roundTo2(total);
  };

  private readonly findCurrentTotalCycleValue = async (input: {
    accountId: string;
    planPrice: string;
    annualDiscount: string | null;
    isTestPlan: boolean | null;
    billingPeriodValue: string | null;
  }): Promise<number> => {
    const basePlanCycleValue = this.calculateBasePlanCycleValue({
      planPrice: input.planPrice,
      annualDiscount: input.annualDiscount,
      isTestPlan: input.isTestPlan,
      billingPeriodValue: input.billingPeriodValue,
    });

    const addonCycleTotal = await this.findActiveAddonCycleTotal({
      accountId: input.accountId,
      billingPeriodValue: input.billingPeriodValue,
    });

    return this.roundTo2(basePlanCycleValue + addonCycleTotal);
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
            recurring_payment: true,
            cancellation_date: true,
            value: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
                name: true,
                price: true,
                price_old: true,
                description: true,
                annual_discount: true,
                icon: true,
                is_test: true,
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
        account_status_id: true,
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

  private readonly findMostRecentPlanAccount = (
    accountResult: Awaited<
      ReturnType<typeof this.findAccountWithPlanAccounts>
    > | null
  ) => {
    if (!accountResult?.apc || accountResult.apc.length === 0) {
      return null;
    }

    const planAccountsWithDate = accountResult.apc
      .filter((pa) => pa.last_payment_date || pa.cancellation_date)
      .map((pa) => ({
        ...pa,
        sortDate: pa.last_payment_date || pa.cancellation_date || '',
      }))
      .sort((a, b) => {
        const dateA = new Date(a.sortDate).getTime();
        const dateB = new Date(b.sortDate).getTime();
        return dateB - dateA;
      });

    return planAccountsWithDate.length > 0
      ? planAccountsWithDate[0]
      : accountResult.apc[0];
  };

  private readonly findLastPaidInvoiceValue = async (
    accountId: string
  ): Promise<string | null> => {
    const payment = await this.dbRo.query.accountPayment.findFirst({
      where: and(
        eq(accountPayment.account_id, accountId),
        inArray(accountPayment.payment_status_id, this.paidStatuses),
        isNotNull(accountPayment.payment_date)
      ),
      columns: {
        value: true,
        payment_date: true,
        created_at: true,
      },
      orderBy: (ap, { desc }) => [desc(ap.payment_date), desc(ap.created_at)],
    });

    return payment?.value || null;
  };

  private readonly getBillingPeriod = (
    billingPeriodName: string | null | undefined,
    lastPaymentDate: string | null,
    nextPaymentDate: string | null
  ): string | null => {
    if (billingPeriodName) {
      return billingPeriodName;
    }

    return calculateBillingPeriodByDates(lastPaymentDate, nextPaymentDate);
  };

  private readonly buildPlanInvoiceResponse = (input: {
    planData: {
      plan_id: string;
      name: string;
      price: string;
      price_old: string;
      description: string | null;
      annual_discount: string | null;
      icon: string | null;
      is_test: boolean | null;
    };
    lastPaymentDate: string | null;
    nextPaymentDate: string | null;
    recurringPayment: boolean;
    cancellationDate: string | null;
    billingPeriodValue: string | null;
    planAccountValue: string | null;
    lastPaidInvoiceValue: string | null;
    currentTotalCycleValue: number;
    accountStatusId: string | null;
  }): ViewCurrentPlanInvoiceResponse => {
    return {
      plan_id: input.planData.plan_id,
      plan_name: input.planData.name,
      plan_icon: input.planData.icon,
      plan_price: Number(input.planData.price),
      plan_price_old: Number(input.planData.price_old),
      plan_description: input.planData.description,
      annual_discount: input.planData.annual_discount
        ? String(input.planData.annual_discount)
        : null,
      is_test: input.planData.is_test ?? null,
      next_payment_date: input.nextPaymentDate,
      last_payment_date: input.lastPaymentDate,
      recurring_payment: input.recurringPayment,
      cancellation_date: input.cancellationDate,
      billing_period: input.billingPeriodValue,
      plan_account_value: input.planAccountValue
        ? Number(input.planAccountValue)
        : null,
      last_paid_invoice_value: input.lastPaidInvoiceValue
        ? Number(input.lastPaidInvoiceValue)
        : null,
      current_total_cycle_value: input.currentTotalCycleValue,
      account_status_id: input.accountStatusId,
    };
  };

  private readonly buildEmptyResponse = (): ViewCurrentPlanInvoiceResponse => {
    return {
      plan_id: null,
      plan_name: null,
      plan_icon: null,
      plan_price: null,
      plan_price_old: null,
      plan_description: null,
      annual_discount: null,
      is_test: null,
      next_payment_date: null,
      last_payment_date: null,
      recurring_payment: null,
      cancellation_date: null,
      billing_period: null,
      plan_account_value: null,
      last_paid_invoice_value: null,
      current_total_cycle_value: null,
      account_status_id: null,
    };
  };
}
