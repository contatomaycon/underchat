import * as schema from '@core/models';
import { server, serverWeb, worker, account, apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';
import { IViewChannelContext } from '@core/common/interfaces/IViewChannelContext';

@injectable()
export class ChannelViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  viewChannelContext = async (
    channelId: string
  ): Promise<IViewChannelContext | null> => {
    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        name: worker.name,
      })
      .from(worker)
      .where(and(isNull(worker.deleted_at), eq(worker.worker_id, channelId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewChannelContext;
  };

  existsActiveAccountByIdConsistent = async (
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .select({ account_id: account.account_id })
      .from(account)
      .where(and(eq(account.account_id, accountId), isNull(account.deleted_at)))
      .execute();

    return result.length > 0;
  };

  viewChannelBalancer = async (
    channelId: string
  ): Promise<IViewWorkerServer | null> => {
    const result = await this.dbRw
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
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(and(isNull(worker.deleted_at), eq(worker.worker_id, channelId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerServer;
  };
}
