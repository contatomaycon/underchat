import * as schema from '@core/models';
import { planCrossSellAccount, planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';

@injectable()
export class AccountAddonCancellerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findAddonById = async (
    accountId: string,
    planCrossSellAccountId: string
  ): Promise<{
    plan_cross_sell_account_id: string;
    cancellation_date: string | null;
    plan_product_id: string;
  } | null> => {
    const addon = await this.dbRw.query.planCrossSellAccount.findFirst({
      where: and(
        eq(planCrossSellAccount.account_id, accountId),
        eq(
          planCrossSellAccount.plan_cross_sell_account_id,
          planCrossSellAccountId
        ),
        isNull(planCrossSellAccount.deleted_at)
      ),
      columns: {
        plan_cross_sell_account_id: true,
        cancellation_date: true,
      },
      with: {
        pca: {
          columns: {
            plan_product_id: true,
          },
        },
      },
    });

    return addon
      ? {
          plan_cross_sell_account_id: addon.plan_cross_sell_account_id,
          cancellation_date: addon.cancellation_date,
          plan_product_id: addon.pca.plan_product_id,
        }
      : null;
  };

  hasActivePlanCycle = async (accountId: string): Promise<boolean> => {
    const rows = await this.dbRw
      .select({
        active: sql<boolean>`${planAccount.next_payment_date} > NOW()`,
      })
      .from(planAccount)
      .where(eq(planAccount.account_id, accountId))
      .orderBy(
        sql`${planAccount.updated_at} DESC NULLS LAST`,
        sql`${planAccount.created_at} DESC NULLS LAST`,
        sql`${planAccount.plan_account_id} DESC`
      )
      .limit(1)
      .execute();

    return rows[0]?.active === true;
  };

  scheduleAddonCancellation = async (data: {
    accountId: string;
    planCrossSellAccountId: string;
    cancellationDate: string;
  }): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const currentPlans = await tx
        .select({
          active: sql<boolean>`${planAccount.next_payment_date} > NOW()`,
        })
        .from(planAccount)
        .where(eq(planAccount.account_id, data.accountId))
        .orderBy(
          sql`${planAccount.updated_at} DESC NULLS LAST`,
          sql`${planAccount.created_at} DESC NULLS LAST`,
          sql`${planAccount.plan_account_id} DESC`
        )
        .limit(1)
        .for('update')
        .execute();

      if (currentPlans[0]?.active !== true) {
        return false;
      }

      const result = await tx
        .update(planCrossSellAccount)
        .set({
          cancellation_date: data.cancellationDate,
          updated_at: data.cancellationDate,
        })
        .where(
          and(
            eq(planCrossSellAccount.account_id, data.accountId),
            eq(
              planCrossSellAccount.plan_cross_sell_account_id,
              data.planCrossSellAccountId
            ),
            isNull(planCrossSellAccount.deleted_at),
            isNull(planCrossSellAccount.cancellation_date)
          )
        )
        .execute();

      return (result.rowCount ?? 0) > 0;
    });
  };
}
