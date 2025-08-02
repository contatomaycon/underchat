import * as schema from '@core/models';
import { serverSsh } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, isNull } from 'drizzle-orm';
import { IListerServerSsh } from '@core/common/interfaces/IListerServerSsh';

@injectable()
export class ServerSshListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listServerSsh = async (): Promise<IListerServerSsh[]> => {
    const result = await this.db
      .select({
        server_id: serverSsh.server_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
      })
      .from(serverSsh)
      .where(and(isNull(serverSsh.deleted_at)))
      .execute();

    if (!result?.length) {
      return [] as IListerServerSsh[];
    }

    return result as IListerServerSsh[];
  };
}
