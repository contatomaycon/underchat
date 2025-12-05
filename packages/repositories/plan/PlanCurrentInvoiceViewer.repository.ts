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

    if (!activePlanAccount?.ppl) {
      return this.buildEmptyResponse();
    }

    const billingPeriodValue = this.getBillingPeriod(
      activePlanAccount.bpl?.name,
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date
    );

    return this.buildPlanInvoiceResponse(
      activePlanAccount.ppl,
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date,
      activePlanAccount.recurring_payment,
      activePlanAccount.cancellation_date,
      billingPeriodValue
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
      },
    });
  };

  private readonly findActivePlanAccount = (accountResult: any) => {
    return accountResult?.apc?.find((pa: any) => pa.pas?.name === 'active');
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
    planData: any,
    lastPaymentDate: string | null,
    nextPaymentDate: string | null,
    recurringPayment: boolean,
    cancellationDate: string | null,
    billingPeriodValue: string | null
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
    };
  };
}
