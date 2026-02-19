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
      WITH latest_plan_account AS (
        SELECT DISTINCT ON (pa.account_id)
          pa.account_id,
          pa.plan_account_id,
          pa.plan_id,
          pa.next_payment_date,
          p.is_test
        FROM "plan_account" pa
        INNER JOIN "plan" p
          ON p.plan_id = pa.plan_id
        WHERE pa.next_payment_date IS NOT NULL
        ORDER BY
          pa.account_id,
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST
      )
      SELECT
        lpa.account_id,
        lpa.plan_account_id,
        lpa.plan_id,
        lpa.is_test,
        lpa.next_payment_date
      FROM latest_plan_account lpa
      INNER JOIN "account" a
        ON a.account_id = lpa.account_id
      WHERE
        a.deleted_at IS NULL
        AND COALESCE(a.bucket_deleted, false) = false
        AND (
          (
            lpa.is_test = true
            AND lpa.next_payment_date::timestamptz <= NOW() - INTERVAL '24 hours'
          )
          OR
          (
            lpa.is_test = false
            AND lpa.next_payment_date::timestamptz <= NOW() - INTERVAL '7 days'
          )
        )
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
