import * as schema from '@core/models';
import { workerProfileStatus, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, sql } from 'drizzle-orm';
import { IPermanentStatusToRenew } from '@core/common/interfaces/IPermanentStatusToRenew';

@injectable()
export class WorkerProfileStatusPermanentRenewalListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPermanentStatusToRenew = async (): Promise<IPermanentStatusToRenew[]> => {
    const results = await this.db
      .select({
        worker_profile_status_id: workerProfileStatus.worker_profile_status_id,
        worker_id: workerProfileStatus.worker_id,
        account_id: worker.account_id,
        worker_profile_status_type_id:
          workerProfileStatus.worker_profile_status_type_id,
        value: workerProfileStatus.value,
        is_permanent: workerProfileStatus.is_permanent,
      })
      .from(workerProfileStatus)
      .innerJoin(worker, eq(worker.worker_id, workerProfileStatus.worker_id))
      .where(
        and(
          eq(workerProfileStatus.is_permanent, true),
          sql`${workerProfileStatus.updated_at} < NOW() - INTERVAL '24 hours'`
        )
      )
      .execute();

    return (results?.length ? results : []) as IPermanentStatusToRenew[];
  };
}
