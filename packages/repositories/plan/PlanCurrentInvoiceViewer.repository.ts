import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';

@injectable()
export class PlanCurrentInvoiceViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

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

    return this.buildPlanInvoiceResponse({
      planData: planAccount.ppl,
      lastPaymentDate: planAccount.last_payment_date,
      nextPaymentDate: planAccount.next_payment_date,
      recurringPayment: planAccount.recurring_payment,
      cancellationDate: planAccount.cancellation_date,
      billingPeriodValue,
      planAccountValue: planAccount.value,
      accountStatusId: accountResult?.account_status_id || null,
    });
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
      account_status_id: null,
    };
  };
}
