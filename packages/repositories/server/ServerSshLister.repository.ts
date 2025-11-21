import * as schema from '@core/models';
import { serverSsh, server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, isNull, eq, or } from 'drizzle-orm';
import { IListerServerSsh } from '@core/common/interfaces/IListerServerSsh';
import { EServerStatus } from '@core/common/enums/EServerStatus';

@injectable()
export class ServerSshListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listServerSsh = async (): Promise<IListerServerSsh[]> => {
    const result = await this.db
      .select({
        server_id: serverSsh.server_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
      })
      .from(serverSsh)
      .innerJoin(server, eq(server.server_id, serverSsh.server_id))
      .where(
        and(
          isNull(serverSsh.deleted_at),
          or(
            eq(server.server_status_id, EServerStatus.offline),
            eq(server.server_status_id, EServerStatus.online)
          )
        )
      )
      .execute();

    if (!result?.length) {
      return [] as IListerServerSsh[];
    }

    return result as IListerServerSsh[];
  };
}
