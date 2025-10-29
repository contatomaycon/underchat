import * as schema from '@core/models';
import { server, serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class ServerSshViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsServerByIp = async (ip: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(serverSsh)
      .innerJoin(server, eq(server.server_id, serverSsh.server_id))
      .where(and(eq(serverSsh.ssh_ip, ip), isNull(server.deleted_at)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
