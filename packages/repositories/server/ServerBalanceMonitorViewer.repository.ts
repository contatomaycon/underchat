import * as schema from '@core/models';
import { server, serverSsh, serverWeb } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';

@injectable()
export class ServerBalanceMonitorViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listEligible = async (): Promise<IBalanceMonitorServer[]> => {
    const excluded = [
      EServerStatus.new,
      EServerStatus.installing,
      EServerStatus.error,
    ];

    const result = await this.db
      .select({
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
      .where(
        and(
          isNull(server.deleted_at),
          notInArray(server.server_status_id, excluded)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as IBalanceMonitorServer[];
  };
}
