import * as schema from '@core/models';
import {
  account,
  planAccount,
  planAccountStatus,
  plan,
  accountPayment,
  billingPeriod,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/plan/viewCurrentPlanInvoice/response.schema';
import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';

const FREE_PLAN_ID = '019a930d-c6f4-75ad-88ff-9a1b2c3d4e5f';

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
      return this.getFreePlanResponse();
    }

    const billingPeriodValue = await this.getBillingPeriod(
      activePlanAccount.plan_account_id,
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date
    );

    return this.buildPlanInvoiceResponse(
      activePlanAccount.ppl,
      activePlanAccount.last_payment_date,
      activePlanAccount.next_payment_date,
      activePlanAccount.recurring_payment,
      billingPeriodValue
    );
  };

  private findAccountWithPlanAccounts = async (accountId: string) => {
    return this.db.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
            last_payment_date: true,
            recurring_payment: true,
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
          },
        },
      },
      columns: {
        account_id: true,
      },
    });
  };

  private findActivePlanAccount = (accountResult: any) => {
    return accountResult?.apc?.find((pa: any) => pa.pas?.name === 'active');
  };

  private getFreePlanResponse =
    async (): Promise<ViewCurrentPlanInvoiceResponse> => {
      const freePlan = await this.db.query.plan.findFirst({
        where: and(eq(plan.plan_id, FREE_PLAN_ID), isNull(plan.deleted_at)),
        columns: {
          plan_id: true,
          name: true,
          price: true,
          price_old: true,
          description: true,
          annual_discount: true,
          icon: true,
        },
      });

      if (!freePlan) {
        return this.buildEmptyResponse();
      }

      return {
        plan_id: freePlan.plan_id,
        plan_name: freePlan.name,
        plan_icon: freePlan.icon,
        plan_price: Number(freePlan.price),
        plan_price_old: Number(freePlan.price_old),
        plan_description: freePlan.description,
        annual_discount: freePlan.annual_discount
          ? String(freePlan.annual_discount)
          : null,
        next_payment_date: null,
        last_payment_date: null,
        recurring_payment: false,
        billing_period: 'monthly',
      };
    };

  private getBillingPeriod = async (
    planAccountId: string,
    lastPaymentDate: string | null,
    nextPaymentDate: string | null
  ): Promise<string | null> => {
    const billingPeriodFromPayment =
      await this.getBillingPeriodFromLastPayment(planAccountId);

    if (billingPeriodFromPayment) {
      return billingPeriodFromPayment;
    }

    return calculateBillingPeriodByDates(lastPaymentDate, nextPaymentDate);
  };

  private getBillingPeriodFromLastPayment = async (
    planAccountId: string
  ): Promise<string | null> => {
    const lastPayment = await this.db
      .select({
        billing_period_name: billingPeriod.name,
      })
      .from(accountPayment)
      .leftJoin(
        billingPeriod,
        eq(accountPayment.billing_period_id, billingPeriod.billing_period_id)
      )
      .where(eq(accountPayment.plan_account_id, planAccountId))
      .orderBy(
        desc(accountPayment.payment_date),
        desc(accountPayment.created_at)
      )
      .limit(1)
      .execute()
      .then((results) => results[0] || null);

    return lastPayment?.billing_period_name ?? null;
  };

  private buildPlanInvoiceResponse = (
    planData: any,
    lastPaymentDate: string | null,
    nextPaymentDate: string | null,
    recurringPayment: boolean,
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
      billing_period: billingPeriodValue,
    };
  };

  private buildEmptyResponse = (): ViewCurrentPlanInvoiceResponse => {
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
      billing_period: null,
    };
  };
}
