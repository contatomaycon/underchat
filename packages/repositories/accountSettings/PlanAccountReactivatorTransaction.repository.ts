import * as schema from '@core/models';
import { planAccount, account } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  ExtractTablesWithRelations,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { TFunction } from 'i18next';

@injectable()
export class PlanAccountReactivatorTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly reactivatePlanAccount = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountId: string
  ): Promise<boolean> => {
    const currentPlans = await tx
      .select({ plan_account_id: planAccount.plan_account_id })
      .from(planAccount)
      .where(eq(planAccount.account_id, accountId))
      .orderBy(
        sql`${planAccount.updated_at} DESC NULLS LAST`,
        sql`${planAccount.created_at} DESC NULLS LAST`,
        sql`${planAccount.plan_account_id} DESC`
      )
      .limit(1)
      .for('update')
      .execute();

    const currentPlan = currentPlans[0];
    if (!currentPlan) {
      return false;
    }

    const result = await tx
      .update(planAccount)
      .set({
        cancellation_date: null,
      })
      .where(eq(planAccount.plan_account_id, currentPlan.plan_account_id))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  private readonly reactivateAccount = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountId: string
  ): Promise<boolean> => {
    const result = await tx
      .update(account)
      .set({
        account_status_id: EAccountStatus.active,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(account.account_id, accountId),
          ne(account.account_status_id, EAccountStatus.blocked),
          isNull(account.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  executeReactivation = async (
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> => {
    await this.dbRw.transaction(async (tx) => {
      const planReactivated = await this.reactivatePlanAccount(tx, accountId);

      if (!planReactivated) {
        throw new Error(t('plan_reactivation_error'));
      }

      const accountReactivated = await this.reactivateAccount(tx, accountId);

      if (!accountReactivated) {
        throw new Error(t('account_reactivation_error'));
      }
    });
  };
}
