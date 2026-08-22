import * as schema from '@core/models';
import { server, serverWeb, worker, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import {
  IViewWorkerLifecycleServer,
  IViewWorkerServer,
} from '@core/common/interfaces/IViewWorkerServer';

@injectable()
export class WorkerBalancerViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  /**
   * Reads the minimal routing context from the writer after the worker
   * snapshot was validated. Provider handoff must not disappear merely
   * because the account has no API key or the server has no public web row.
   */
  viewWorkerLifecycleServer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerLifecycleServer | null> => {
    const result = await this.dbRw
      .select({
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        account_id: worker.account_id,
      })
      .from(worker)
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at),
          isNull(server.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return (result?.[0] as IViewWorkerLifecycleServer | undefined) ?? null;
  };

  viewWorkerBalancer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerServer | null> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        server_status_id: server.server_status_id,
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
