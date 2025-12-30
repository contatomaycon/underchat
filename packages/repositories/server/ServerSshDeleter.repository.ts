import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ServerSshDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteServerSshById = async (serverId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(serverSsh)
      .set({
        deleted_at: date,
      })
      .where(eq(serverSsh.server_id, serverId))
      .execute();

    return result.rowCount === 1;
  };
}
