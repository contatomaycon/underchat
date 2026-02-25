import * as schema from '@core/models';
import { server, serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IViewServerSshById } from '@core/common/interfaces/IViewServerSshById';

@injectable()
export class ServerSshViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewServerSshById = async (
    serverId: string
  ): Promise<IViewServerSshById | null> => {
    const result = await this.dbRo
      .select({
        server_status_id: server.server_status_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
        proxy_enabled: server.proxy_enabled,
        proxy_protocol: server.proxy_protocol,
        proxy_host: server.proxy_host,
        proxy_port: server.proxy_port,
        proxy_username: server.proxy_username,
        proxy_password: server.proxy_password,
      })
      .from(serverSsh)
      .innerJoin(server, eq(server.server_id, serverSsh.server_id))
      .where(and(eq(serverSsh.server_id, serverId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewServerSshById;
  };
}
