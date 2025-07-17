import { ICreateServerSsh } from '@core/common/interfaces/ICreateServerSsh';
import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ServerSshCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createServerSsh = async (input: ICreateServerSsh): Promise<number | null> => {
    const result = await this.db
      .insert(serverSsh)
      .values({
        server_id: input.server_id,
        ssh_ip: input.ssh_ip,
        ssh_port: input.ssh_port,
        ssh_username: input.ssh_username,
        ssh_password: input.ssh_password,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return result[0].server_ssh_id;
  };
}
