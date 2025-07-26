import * as schema from '@core/models';
import { server, serverSsh, worker, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, lt, count, asc } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { IViewWorkerBalancerServer } from '@core/common/interfaces/IViewWorkerBalancerServer';

@injectable()
export class WorkerBalancerServerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerBalancerServer = async (
    accountId: string
  ): Promise<IViewWorkerBalancerServer | null> => {
    const result = await this.db
      .select({
        server_id: server.server_id,
        ssh_ip: serverSsh.ssh_ip,
        key: apiKey.key,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(apiKey, eq(apiKey.account_id, accountId))
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
      .groupBy(
        server.server_id,
        server.quantity_workers,
        serverSsh.ssh_ip,
        apiKey.key
      )
      .having(lt(count(worker.worker_id), server.quantity_workers))
      .orderBy(asc(count(worker.worker_id)))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerBalancerServer;
  };
}
