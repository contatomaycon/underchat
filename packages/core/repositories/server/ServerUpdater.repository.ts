import * as schema from '@core/models';
import { server, serverSsh } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { IUpdateServerById } from '@core/common/interfaces/IUpdateServerById';
import { IUpdateServerSshById } from '@core/common/interfaces/IUpdateServerSshById';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { TFunction } from 'i18next';

@injectable()
export class ServerUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateServerById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: IUpdateServerById
  ): Promise<boolean> => {
    const result = await tx
      .update(server)
      .set({
        name: input.name,
      })
      .where(eq(server.server_id, input.server_id))
      .execute();

    return result.rowCount === 1;
  };

  private updateServerSshById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: IUpdateServerSshById
  ): Promise<boolean> => {
    const updateServer: Partial<typeof serverSsh.$inferInsert> = {
      ssh_ip: input.ssh_ip,
      ssh_port: input.ssh_port,
    };

    if (input.ssh_username) {
      updateServer.ssh_username = input.ssh_username;
    }

    if (input.ssh_password) {
      updateServer.ssh_password = input.ssh_password;
    }

    const result = await tx
      .update(serverSsh)
      .set(updateServer)
      .where(eq(serverSsh.server_id, input.server_id))
      .execute();

    return result.rowCount === 1;
  };

  updateServer = async (
    t: TFunction<'translation', undefined>,
    inputServer: IUpdateServerById,
    inputServerSsh: IUpdateServerSshById
  ): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const updateServerResult = await this.updateServerById(tx, inputServer);
      if (!updateServerResult) {
        throw new Error(t('server_update_error'));
      }

      const updateServerSshResult = await this.updateServerSshById(
        tx,
        inputServerSsh
      );

      if (!updateServerSshResult) {
        throw new Error(t('server_ssh_update_error'));
      }

      return true;
    });
  };
}
