import { IExpiredAccountBucket } from '@core/common/interfaces/IExpiredAccountBucket';
import { currentTime } from '@core/common/functions/currentTime';
import * as schema from '@core/models';
import { account } from '@core/models';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountExpiredBucketCleanupRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listAccountsWithExpiredPlanAndBucketPendingDeletion = async (): Promise<
    IExpiredAccountBucket[]
  > => {
    const result = await this.dbRo.execute(sql`
      WITH ranked_plan_account AS (
        SELECT
          pa.account_id,
          pa.plan_account_id,
          pa.plan_id,
          pa.next_payment_date,
          p.is_test,
          ROW_NUMBER() OVER (
            PARTITION BY pa.account_id
            ORDER BY
              pa.next_payment_date DESC NULLS LAST,
              pa.updated_at DESC NULLS LAST,
              pa.created_at DESC NULLS LAST
          ) AS row_num
        FROM "plan_account" pa
        INNER JOIN "plan" p
          ON p.plan_id = pa.plan_id
        WHERE pa.next_payment_date IS NOT NULL
      ),
      current_plan_account AS (
        SELECT
          rpa.account_id,
          rpa.plan_account_id,
          rpa.plan_id,
          rpa.next_payment_date,
          rpa.is_test
        FROM ranked_plan_account rpa
        WHERE rpa.row_num = 1
      )
      SELECT
        cpa.account_id,
        cpa.plan_account_id,
        cpa.plan_id,
        cpa.is_test,
        cpa.next_payment_date
      FROM current_plan_account cpa
      INNER JOIN "account" a
        ON a.account_id = cpa.account_id
      WHERE
        a.deleted_at IS NULL
        AND COALESCE(a.bucket_deleted, false) = false
        AND cpa.next_payment_date::timestamptz < CASE
          WHEN cpa.is_test = true THEN NOW() - INTERVAL '24 hours'
          ELSE NOW() - INTERVAL '7 days'
        END
    `);

    return (result.rows ?? []) as unknown as IExpiredAccountBucket[];
  };

  markBucketAsDeleted = async (accountId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(account)
      .set({
        bucket_deleted: true,
        updated_at: currentTime(),
      })
      .where(eq(account.account_id, accountId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
