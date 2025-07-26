import { ICreateServerSsh } from '@core/common/interfaces/ICreateServerSsh';
import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class ServerSshCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createServerSsh = async (input: ICreateServerSsh): Promise<string | null> => {
    const serverSshId = uuidv4();

    const result = await this.db
      .insert(serverSsh)
      .values({
        server_ssh_id: serverSshId,
        server_id: input.server_id,
        ssh_ip: input.ssh_ip,
        ssh_port: input.ssh_port,
        ssh_username: input.ssh_username,
        ssh_password: input.ssh_password,
      })
      .execute();

    if (result?.rowCount === 0) {
      return null;
    }

    return serverSshId;
  };
}
