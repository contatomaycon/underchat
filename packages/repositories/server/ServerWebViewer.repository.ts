import * as schema from '@core/models';
import { server, serverWeb } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';

@injectable()
export class ServerWebViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewServerWebById = async (
    serverId: string
  ): Promise<IViewServerWebById | null> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(serverWeb)
      .innerJoin(server, eq(server.server_id, serverWeb.server_id))
      .where(
        and(
          eq(serverWeb.server_id, serverId),
          isNull(server.deleted_at),
          isNull(serverWeb.deleted_at)
        )
      )
      .orderBy(
        desc(serverWeb.updated_at),
        desc(serverWeb.created_at),
        desc(serverWeb.server_web_id)
      )
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewServerWebById;
  };
}
