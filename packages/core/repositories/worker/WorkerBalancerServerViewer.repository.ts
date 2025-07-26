import * as schema from '@core/models';
import { server, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, lt, count, asc } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';

@injectable()
export class WorkerBalancerServerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerBalancerServerId = async (): Promise<number | null> => {
    const result = await this.db
      .select({
        server_id: server.server_id,
      })
      .from(server)
      .leftJoin(
        worker,
        and(eq(worker.server_id, server.server_id), isNull(worker.deleted_at))
      )
      .where(
        and(
          isNull(server.deleted_at),
          eq(server.server_status_id, EServerStatus.online)
        )
      )
      .groupBy(server.server_id, server.quantity_workers)
      .having(lt(count(worker.worker_id), server.quantity_workers))
      .orderBy(asc(count(worker.worker_id)))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0].server_id;
  };
}
