import * as schema from '@core/models';
import { serverWeb } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ServerWebDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteServerWebById = async (serverId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(serverWeb)
      .set({
        deleted_at: date,
      })
      .where(eq(serverWeb.server_id, serverId))
      .execute();

    return result.rowCount === 1;
  };
}
