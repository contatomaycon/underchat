import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ServerSshDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteServerSshById = async (serverId: number): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(serverSsh)
      .set({
        deleted_at: date,
      })
      .where(eq(serverSsh.server_id, serverId))
      .execute();

    return result.rowCount === 1;
  };
}
