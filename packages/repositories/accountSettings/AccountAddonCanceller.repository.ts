import * as schema from '@core/models';
import { planCrossSellAccount, planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

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
  } | null> => {
    const addon = await this.dbRo.query.planCrossSellAccount.findFirst({
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
    });

    return addon || null;
  };

  hasActivePlanCycle = async (accountId: string): Promise<boolean> => {
    const rows = await this.dbRo
      .select({
        plan_account_id: planAccount.plan_account_id,
      })
      .from(planAccount)
      .where(
        and(
          eq(planAccount.account_id, accountId),
          gt(planAccount.next_payment_date, sql`NOW()`)
        )
      )
      .limit(1)
      .execute();

    return rows.length > 0;
  };

  scheduleAddonCancellation = async (data: {
    accountId: string;
    planCrossSellAccountId: string;
    cancellationDate: string;
  }): Promise<boolean> => {
    const result = await this.dbRw
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
  };
}
