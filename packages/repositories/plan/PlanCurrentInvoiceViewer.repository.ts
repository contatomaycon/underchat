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
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
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

    return this.buildPlanInvoiceResponse(
      planAccount.ppl,
      planAccount.last_payment_date,
      planAccount.next_payment_date,
      planAccount.recurring_payment,
      planAccount.cancellation_date,
      billingPeriodValue,
      planAccount.value,
      accountResult?.account_status_id || null
    );
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

  private readonly buildPlanInvoiceResponse = (
    planData: {
      plan_id: string;
      name: string;
      price: string;
      price_old: string;
      description: string | null;
      annual_discount: string | null;
      icon: string | null;
    },
    lastPaymentDate: string | null,
    nextPaymentDate: string | null,
    recurringPayment: boolean,
    cancellationDate: string | null,
    billingPeriodValue: string | null,
    planAccountValue: string | null,
    accountStatusId: string | null
  ): ViewCurrentPlanInvoiceResponse => {
    return {
      plan_id: planData.plan_id,
      plan_name: planData.name,
      plan_icon: planData.icon,
      plan_price: Number(planData.price),
      plan_price_old: Number(planData.price_old),
      plan_description: planData.description,
      annual_discount: planData.annual_discount
        ? String(planData.annual_discount)
        : null,
      next_payment_date: nextPaymentDate,
      last_payment_date: lastPaymentDate,
      recurring_payment: recurringPayment,
      cancellation_date: cancellationDate,
      billing_period: billingPeriodValue,
      plan_account_value: planAccountValue ? Number(planAccountValue) : null,
      account_status_id: accountStatusId,
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
