import * as schema from '@core/models';
import { server, serverSsh, serverStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  or,
  SQL,
  SQLWrapper,
} from 'drizzle-orm';
import { ListServerResponse } from '@core/schema/server/listServer/response.schema';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { ESortByServer } from '@core/common/enums/ESortByServer';
import { ESortOrder } from '@core/common/enums/ESortOrder';

@injectable()
export class ServerListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private setOrders = (query: ListServerRequest): SQL<unknown> | undefined => {
    if (query?.sort_by === ESortByServer.name) {
      return query.sort_order === ESortOrder.asc
        ? asc(server.name)
        : desc(server.name);
    }

    if (query?.sort_by === ESortByServer.ssh_ip) {
      return query.sort_order === ESortOrder.asc
        ? asc(serverSsh.ssh_ip)
        : desc(serverSsh.ssh_ip);
    }

    if (query?.sort_by === ESortByServer.ssh_port) {
      return query.sort_order === ESortOrder.asc
        ? asc(serverSsh.ssh_port)
        : desc(serverSsh.ssh_port);
    }

    if (query?.sort_by === ESortByServer.status) {
      return query.sort_order === ESortOrder.asc
        ? asc(serverStatus.status)
        : desc(serverStatus.status);
    }

    return query.sort_order === ESortOrder.asc
      ? asc(server.created_at)
      : desc(server.created_at);
  };

  private setFilters = (query: ListServerRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query?.server_name) {
      filters.push(eq(server.name, query.server_name));
    }

    if (query?.server_status_id) {
      filters.push(eq(serverStatus.server_status_id, query.server_status_id));
    }

    if (query?.ssh_ip) {
      filters.push(eq(serverSsh.ssh_ip, query.ssh_ip));
    }

    if (query?.ssh_port) {
      filters.push(eq(serverSsh.ssh_port, query.ssh_port));
    }

    return filters;
  };

  listServers = async (
    perPage: number,
    currentPage: number,
    query: ListServerRequest
  ): Promise<ListServerResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);

    const queryBuilder = this.db
      .select({
        name: server.name,
        status: {
          id: serverStatus.server_status_id,
          name: serverStatus.status,
        },
        ssh: {
          ssh_ip: serverSsh.ssh_ip,
          ssh_port: serverSsh.ssh_port,
        },
        created_at: server.created_at,
        updated_at: server.updated_at,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(
        serverStatus,
        eq(serverStatus.server_status_id, server.server_status_id)
      )
      .where(and(isNull(server.deleted_at), or(...filters)));

    if (orders) {
      queryBuilder.orderBy(orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListServerResponse[];
    }

    return result as ListServerResponse[];
  };

  listServersTotal = async (query: ListServerRequest): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(
        serverStatus,
        eq(serverStatus.server_status_id, server.server_status_id)
      )
      .where(and(isNull(server.deleted_at), or(...filters)))
      .execute();

    return result[0]?.count ?? 0;
  };
}
