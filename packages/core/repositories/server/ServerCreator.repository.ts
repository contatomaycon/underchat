import { ICreateServer } from '@core/common/interfaces/ICreateServer';
import * as schema from '@core/models';
import { server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class ServerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createServer = async (input: ICreateServer): Promise<string | null> => {
    const serverId = uuidv4();

    const result = await this.db
      .insert(server)
      .values({
        server_id: serverId,
        server_status_id: input.server_status_id,
        name: input.name,
        quantity_workers: input.quantity_workers,
      })
      .execute();

    if (result?.rowCount === 0) {
      return null;
    }

    return serverId;
  };
}
