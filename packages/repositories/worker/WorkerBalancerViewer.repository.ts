import * as schema from '@core/models';
import { server, serverWeb, worker, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';

@injectable()
export class WorkerBalancerViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerBalancer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerServer | null> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        key: apiKey.key,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
        account_id: worker.account_id,
      })
      .from(worker)
      .innerJoin(apiKey, eq(apiKey.account_id, worker.account_id))
      .innerJoin(serverWeb, eq(serverWeb.server_id, worker.server_id))
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          eq(worker.worker_id, workerId)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerServer;
  };
}
