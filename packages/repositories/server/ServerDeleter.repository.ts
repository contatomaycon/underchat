import * as schema from '@core/models';
import { server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ServerDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteServerById = async (serverId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(server)
      .set({
        deleted_at: date,
      })
      .where(eq(server.server_id, serverId))
      .execute();

    return result.rowCount === 1;
  };
}
