import * as schema from '@core/models';
import { server, serverSsh, serverStatus, serverWeb } from '@core/models';
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
  ilike,
} from 'drizzle-orm';
import { ListServerResponse } from '@core/schema/server/listServer/response.schema';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ESortByServer } from '@core/common/enums/ESortByServer';

@injectable()
export class ServerListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListServerRequest): SQL[] => {
    const orders: SQL[] = [];

    if (query.sort_by?.length) {
      query.sort_by.forEach(({ key, order }) => {
        if (key === ESortByServer.name)
          orders.push(
            order === ESortOrder.asc ? asc(server.name) : desc(server.name)
          );

        if (key === ESortByServer.ssh_ip)
          orders.push(
            order === ESortOrder.asc
              ? asc(serverSsh.ssh_ip)
              : desc(serverSsh.ssh_ip)
          );

        if (key === ESortByServer.ssh_port)
          orders.push(
            order === ESortOrder.asc
              ? asc(serverSsh.ssh_port)
              : desc(serverSsh.ssh_port)
          );

        if (key === ESortByServer.web_domain)
          orders.push(
            order === ESortOrder.asc
              ? asc(serverWeb.web_domain)
              : desc(serverWeb.web_domain)
          );

        if (key === ESortByServer.status)
          orders.push(
            order === ESortOrder.asc
              ? asc(serverStatus.server_status_id)
              : desc(serverStatus.server_status_id)
          );
      });
    }

    if (!query.sort_by?.length) {
      orders.push(asc(server.created_at), desc(server.server_id));
    }

    return orders;
  };

  private readonly setFilters = (query: ListServerRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.server_name || query.ssh_ip || query.web_domain) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.server_name
          ? ilike(server.name, `%${query.server_name}%`)
          : undefined,
        query.ssh_ip ? ilike(serverSsh.ssh_ip, `%${query.ssh_ip}%`) : undefined,
        query.web_domain
          ? ilike(serverWeb.web_domain, `%${query.web_domain}%`)
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.server_status_id) {
      filters.push(eq(serverStatus.server_status_id, query.server_status_id));
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
        id: server.server_id,
        name: server.name,
        quantity_workers: server.quantity_workers,
        status: {
          id: serverStatus.server_status_id,
          name: serverStatus.status,
        },
        ssh: {
          ssh_ip: serverSsh.ssh_ip,
          ssh_port: serverSsh.ssh_port,
        },
        web: {
          web_domain: serverWeb.web_domain,
          web_port: serverWeb.web_port,
          web_protocol: serverWeb.web_protocol,
        },
        last_sync: server.last_sync,
        created_at: server.created_at,
        updated_at: server.updated_at,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(
        serverStatus,
        eq(serverStatus.server_status_id, server.server_status_id)
      )
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
      .where(and(isNull(server.deleted_at), or(...filters)));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
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
