import * as schema from '@core/models';
import { server, serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IViewServerSshById } from '@core/common/interfaces/IViewServerSshById';

@injectable()
export class ServerSshViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewServerSshById = async (
    id: number
  ): Promise<IViewServerSshById | null> => {
    const result = await this.db
      .select({
        server_status_id: server.server_status_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
      })
      .from(serverSsh)
      .innerJoin(server, eq(server.server_id, serverSsh.server_id))
      .where(and(eq(serverSsh.server_id, id)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewServerSshById;
  };
}
