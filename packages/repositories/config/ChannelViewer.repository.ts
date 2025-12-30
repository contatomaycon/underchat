import * as schema from '@core/models';
import { server, serverWeb, worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';

@injectable()
export class ChannelViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewChannelBalancer = async (
    channelId: string
  ): Promise<IViewWorkerServer | null> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        key: schema.apiKey.key,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
        account_id: worker.account_id,
      })
      .from(worker)
      .innerJoin(schema.apiKey, eq(schema.apiKey.account_id, worker.account_id))
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
