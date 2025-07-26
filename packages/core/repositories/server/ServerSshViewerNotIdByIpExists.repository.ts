import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, ne } from 'drizzle-orm';

@injectable()
export class ServerSshViewerNotIdByIpExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsServerNotIdAndByIp = async (
    serverId: string,
    ip: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(serverSsh)
      .where(and(eq(serverSsh.ssh_ip, ip), ne(serverSsh.server_id, serverId)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
