import * as schema from '@core/models';
import { planAccount, account, plan, accountPayment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { IPlanAccountRenewal } from '@core/common/interfaces/IPlanAccountRenewal';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';

@injectable()
export class PlanAccountRenewalListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountsForRenewal = async (): Promise<IPlanAccountRenewal[]> => {
    const now = new Date();
    const threeHoursLater = new Date(now);
    threeHoursLater.setHours(threeHoursLater.getHours() + 3);
    const threeHoursLaterISO = threeHoursLater.toISOString();

    const result = await this.dbRw.query.planAccount.findMany({
      where: and(
        eq(planAccount.recurring_payment, true),
        isNull(planAccount.cancellation_date),
        sql`${planAccount.next_payment_date} IS NOT NULL`,
        sql`${planAccount.next_payment_date}::timestamptz <= ${threeHoursLaterISO}::timestamptz`,
        sql`EXISTS (
          SELECT 1 
          FROM ${account} a
          WHERE a.account_id = ${planAccount.account_id}
            AND a.deleted_at IS NULL
            AND a.account_status_id = ${EAccountStatus.active}
        )`,
        sql`EXISTS (
          SELECT 1 
          FROM ${plan} p
          WHERE p.plan_id = ${planAccount.plan_id}
            AND p.deleted_at IS NULL
        )`
      ),
      columns: {
        plan_account_id: true,
        account_id: true,
        plan_id: true,
        billing_period_id: true,
        value: true,
        last_payment_date: true,
        next_payment_date: true,
      },
      with: {
        pac: {
          columns: {
            account_id: true,
          },
          with: {
            pca: {
              columns: {
                plan_cross_sell_account_id: true,
                deleted_at: true,
                cancellation_date: true,
              },
              with: {
                pca: {
                  columns: {
                    plan_cross_sell_id: true,
                    quantity: true,
                    price: true,
                    deleted_at: true,
                  },
                },
              },
            },
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
            is_test: true,
            days_trial: true,
          },
        },
      },
    });

    const items: IPlanAccountRenewal[] = [];

    for (const item of result) {
      if (!item.next_payment_date || !item.pac || !item.ppl) {
        continue;
      }

      const crossSells: IPlanAccountRenewal['cross_sells'] = [];

      if (item.pac.pca) {
        for (const cs of item.pac.pca) {
          if (
            cs &&
            !cs.deleted_at &&
            !cs.cancellation_date &&
            cs.pca &&
            !cs.pca.deleted_at
          ) {
            crossSells.push({
              plan_cross_sell_id: cs.pca.plan_cross_sell_id,
              plan_cross_sell_account_id: cs.plan_cross_sell_account_id,
              quantity: cs.pca.quantity,
              price: cs.pca.price,
            });
          }
        }
      }

      items.push({
        plan_account_id: item.plan_account_id,
        account_id: item.account_id,
        plan_id: item.plan_id,
        billing_period_id: item.billing_period_id,
        value: item.value,
        last_payment_date: item.last_payment_date,
        next_payment_date: item.next_payment_date,
        plan: {
          plan_id: item.ppl.plan_id,
          name: item.ppl.name,
          price: item.ppl.price,
          price_old: item.ppl.price_old,
          description: item.ppl.description,
          annual_discount: item.ppl.annual_discount,
          icon: item.ppl.icon,
          is_test: item.ppl.is_test,
          days_trial: item.ppl.days_trial,
        },
        cross_sells: crossSells,
      });
    }

    return items;
  };

  findPendingSuccessfulRenewalPayment = async (data: {
    accountId: string;
    planId: string;
    lastPaymentDate: string | null;
  }): Promise<{
    account_payment_id: string;
    billing_period_id: string | null;
    recurring_payment: boolean;
    value: string;
    payment_date: string | null;
    payment_status_id: string;
    created_at: string | null;
  } | null> => {
    const successfulStatuses = [
      EPaymentStatus.received,
      EPaymentStatus.confirmed,
      EPaymentStatus.received_in_cash,
    ];

    const renewalWindowCondition = data.lastPaymentDate
      ? or(
          gte(accountPayment.created_at, data.lastPaymentDate),
          gte(accountPayment.payment_date, data.lastPaymentDate)
        )
      : undefined;

    const whereConditions = [
      eq(accountPayment.account_id, data.accountId),
      eq(accountPayment.plan_id, data.planId),
      eq(accountPayment.is_addon_only, false),
      eq(
        accountPayment.payment_billing_type_id,
        EPaymentBillingType.credit_card
      ),
      inArray(accountPayment.payment_status_id, successfulStatuses),
      or(
        isNull(accountPayment.release_status),
        ne(
          accountPayment.release_status,
          EAccountPaymentReleaseStatus.processed
        )
      ),
    ];

    if (renewalWindowCondition) {
      whereConditions.push(renewalWindowCondition);
    }

    const payment = await this.dbRw
      .select({
        account_payment_id: accountPayment.account_payment_id,
        billing_period_id: accountPayment.billing_period_id,
        recurring_payment: accountPayment.recurring_payment,
        value: accountPayment.value,
        payment_date: accountPayment.payment_date,
        payment_status_id: accountPayment.payment_status_id,
        created_at: accountPayment.created_at,
      })
      .from(accountPayment)
      .where(and(...whereConditions))
      .orderBy(desc(accountPayment.created_at))
      .limit(1)
      .execute();

    return payment[0] || null;
  };
}
