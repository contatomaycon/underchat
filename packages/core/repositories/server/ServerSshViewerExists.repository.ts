import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';

@injectable()
export class ServerSshViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewByIp = async (ip: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(serverSsh)
      .where(and(eq(serverSsh.ssh_ip, ip)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
