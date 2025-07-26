import { ICreateServer } from '@core/common/interfaces/ICreateServer';
import * as schema from '@core/models';
import { server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ServerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createServer = async (input: ICreateServer): Promise<number | null> => {
    const result = await this.db
      .insert(server)
      .values({
        server_status_id: input.server_status_id,
        name: input.name,
        quantity_workers: input.quantity_workers,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return result[0].server_id;
  };
}
