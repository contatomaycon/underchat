import * as schema from '@core/models';
import { planAccount, account } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
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
    const result = await tx
      .update(planAccount)
      .set({
        cancellation_date: null,
        updated_at: currentTime(),
      })
      .where(eq(planAccount.account_id, accountId))
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
      .where(eq(account.account_id, accountId))
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
