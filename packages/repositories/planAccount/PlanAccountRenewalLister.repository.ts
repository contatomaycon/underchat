import * as schema from '@core/models';
import { planAccount, account, plan } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { IPlanAccountRenewal } from '@core/common/interfaces/IPlanAccountRenewal';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class PlanAccountRenewalListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountsForRenewal = async (): Promise<IPlanAccountRenewal[]> => {
    const now = new Date();
    const startOfDay = new Date(now);

    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayISO = startOfDay.toISOString();

    const result = await this.db.query.planAccount.findMany({
      where: and(
        eq(planAccount.recurring_payment, true),
        isNull(planAccount.cancellation_date),
        sql`DATE(${planAccount.next_payment_date}::timestamptz) <= DATE(${sql.raw(`'${startOfDayISO}'`)}::timestamptz)`,
        sql`${planAccount.next_payment_date} IS NOT NULL`,
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

    return result
      .filter((item) => item.next_payment_date !== null && item.pac && item.ppl)
      .map((item) => {
        const crossSells =
          item.pac?.pca
            ?.filter((cs) => !cs.deleted_at && cs.pca && !cs.pca.deleted_at)
            .map((cs) => ({
              plan_cross_sell_id: cs.pca!.plan_cross_sell_id,
              plan_cross_sell_account_id: cs.plan_cross_sell_account_id,
              quantity: cs.pca!.quantity,
              price: cs.pca!.price,
            })) || [];

        return {
          plan_account_id: item.plan_account_id,
          account_id: item.account_id,
          plan_id: item.plan_id,
          billing_period_id: item.billing_period_id,
          value: item.value,
          next_payment_date: item.next_payment_date!,
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
        } as IPlanAccountRenewal;
      });
  };
}
