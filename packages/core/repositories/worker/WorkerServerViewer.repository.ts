import * as schema from '@core/models';
import { server, serverWeb, worker, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, lt, count, asc } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';

@injectable()
export class WorkerServerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerServer = async (
    accountId: string
  ): Promise<IViewWorkerServer | null> => {
    const result = await this.db
      .select({
        server_id: server.server_id,
        key: apiKey.key,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(server)
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
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
        apiKey.key,
        serverWeb.web_domain,
        serverWeb.web_port,
        serverWeb.web_protocol
      )
      .having(lt(count(worker.worker_id), server.quantity_workers))
      .orderBy(asc(count(worker.worker_id)))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerServer;
  };
}
