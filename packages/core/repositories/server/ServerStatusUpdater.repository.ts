import * as schema from '@core/models';
import { server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';

@injectable()
export class ServerStatusUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateServerStatusById = async (
    serverId: string,
    status: EServerStatus
  ): Promise<boolean> => {
    const result = await this.db
      .update(server)
      .set({
        server_status_id: status,
      })
      .where(eq(server.server_id, serverId))
      .execute();

    return result.rowCount === 1;
  };
}
