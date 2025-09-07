import * as schema from '@core/models';
import { server, serverWeb } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';

@injectable()
export class ServerWebViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewServerWebById = async (
    serverId: string
  ): Promise<IViewServerWebById | null> => {
    const result = await this.db
      .select({
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(serverWeb)
      .innerJoin(server, eq(server.server_id, serverWeb.server_id))
      .where(and(eq(serverWeb.server_id, serverId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewServerWebById;
  };
}
