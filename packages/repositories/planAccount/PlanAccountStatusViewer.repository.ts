import * as schema from '@core/models';
import { account, planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { desc, eq } from 'drizzle-orm';
import { IPlanAccountStatus } from '@core/common/interfaces/IPlanAccountStatus';

@injectable()
export class PlanAccountStatusViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewLatestByAccountId = async (
    accountId: string
  ): Promise<IPlanAccountStatus | null> => {
    const result = await this.db
      .select({
        account_status_id: account.account_status_id,
        next_payment_date: planAccount.next_payment_date,
        cancellation_date: planAccount.cancellation_date,
      })
      .from(planAccount)
      .innerJoin(account, eq(account.account_id, planAccount.account_id))
      .where(eq(planAccount.account_id, accountId))
      .orderBy(desc(planAccount.created_at))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };
}
