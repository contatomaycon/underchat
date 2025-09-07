import * as schema from '@core/models';
import { server, serverSsh, serverWeb } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { TFunction } from 'i18next';
import { ICreateServer } from '@core/common/interfaces/ICreateServer';
import { v4 as uuidv4 } from 'uuid';
import { ICreateServerSsh } from '@core/common/interfaces/ICreateServerSsh';
import { ICreateServerWeb } from '@core/common/interfaces/ICreateServerWeb';

@injectable()
export class ServerCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly createServer = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateServer
  ): Promise<string | null> => {
    const serverId = uuidv4();

    const result = await tx
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

  private readonly createServerSsh = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateServerSsh,
    serverId: string
  ): Promise<string | null> => {
    const serverSshId = uuidv4();

    const result = await tx
      .insert(serverSsh)
      .values({
        server_ssh_id: serverSshId,
        server_id: serverId,
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

  private readonly createServerWeb = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateServerWeb,
    serverId: string
  ): Promise<string | null> => {
    const serverWebId = uuidv4();

    const result = await tx
      .insert(serverWeb)
      .values({
        server_web_id: serverWebId,
        server_id: serverId,
        web_domain: input.web_domain,
        web_port: input.web_port,
        web_protocol: input.web_protocol,
      })
      .execute();

    if (result?.rowCount === 0) {
      return null;
    }

    return serverWebId;
  };

  createBalanceServer = async (
    t: TFunction<'translation', undefined>,
    inputServer: ICreateServer,
    inputServerSsh: ICreateServerSsh,
    inputServerWeb: ICreateServerWeb
  ): Promise<string> => {
    return this.db.transaction(async (tx) => {
      const serverId = await this.createServer(tx, inputServer);
      if (!serverId) {
        throw new Error(t('server_create_error'));
      }

      const createServerSshResult = await this.createServerSsh(
        tx,
        inputServerSsh,
        serverId
      );
      if (!createServerSshResult) {
        throw new Error(t('server_ssh_create_error'));
      }

      const createServerWebResult = await this.createServerWeb(
        tx,
        inputServerWeb,
        serverId
      );
      if (!createServerWebResult) {
        throw new Error(t('server_web_create_error'));
      }

      return serverId;
    });
  };
}
