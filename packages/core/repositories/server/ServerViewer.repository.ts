import * as schema from '@core/models';
import { server, serverSsh, serverStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewServerResponse } from '@core/schema/server/viewServer/response.schema';

@injectable()
export class ServerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewServerById = async (
    serverId: number
  ): Promise<ViewServerResponse | null> => {
    const result = await this.db
      .select({
        name: server.name,
        quantity_workers: server.quantity_workers,
        status: {
          id: serverStatus.server_status_id,
          name: serverStatus.status,
        },
        ssh: {
          ssh_ip: serverSsh.ssh_ip,
          ssh_port: serverSsh.ssh_port,
        },
        created_at: server.created_at,
        updated_at: server.updated_at,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(
        serverStatus,
        eq(serverStatus.server_status_id, server.server_status_id)
      )
      .where(and(eq(server.server_id, serverId), isNull(server.deleted_at)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as ViewServerResponse;
  };
}
