import * as schema from '@core/models';
import { server, serverWeb, worker, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerBalancerServer } from '@core/common/interfaces/IViewWorkerBalancerServer';

@injectable()
export class WorkerBalancerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerBalancer = async (
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<IViewWorkerBalancerServer | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(worker.account_id, accountId);

    const result = await this.db
      .select({
        server_id: server.server_id,
        key: apiKey.key,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(worker)
      .innerJoin(apiKey, eq(apiKey.account_id, worker.account_id))
      .innerJoin(serverWeb, eq(serverWeb.server_id, worker.server_id))
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .where(
        and(
          isNull(worker.deleted_at),
          eq(worker.worker_id, workerId),
          accountCondition
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerBalancerServer;
  };
}
