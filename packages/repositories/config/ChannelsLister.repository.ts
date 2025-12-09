import * as schema from '@core/models';
import {
  worker,
  workerStatus,
  workerType,
  server,
  account,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  SQL,
  asc,
  desc,
  SQLWrapper,
  ilike,
  count,
  or,
} from 'drizzle-orm';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ESortByWorker } from '@core/common/enums/ESortByWorker';
import { ESortOrder } from '@core/common/enums/ESortOrder';

@injectable()
export class ChannelsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListChannelsRequest): SQL[] => {
    if (!query.sort_by?.length) {
      return [asc(worker.created_at), desc(worker.worker_id)];
    }

    const mapping: Record<ESortByWorker, SQLWrapper> = {
      [ESortByWorker.name]: worker.name,
      [ESortByWorker.number]: worker.number,
      [ESortByWorker.server]: server.name,
      [ESortByWorker.status]: workerStatus.status,
      [ESortByWorker.type]: workerType.type,
      [ESortByWorker.account]: account.name,
      [ESortByWorker.created_at]: worker.created_at,
    };

    return query.sort_by.map(({ key, order }) => {
      const column = mapping[key as ESortByWorker];

      return order === ESortOrder.asc ? asc(column) : desc(column);
    });
  };

  private readonly setFilters = (query: ListChannelsRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.number || query.server || query.account) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(worker.name, `%${query.name}%`) : undefined,
        query.number ? ilike(worker.number, `%${query.number}%`) : undefined,
        query.server ? ilike(server.name, `%${query.server}%`) : undefined,
        query.account ? ilike(account.name, `%${query.account}%`) : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.status) {
      filters.push(eq(workerStatus.worker_status_id, query.status));
    }

    if (query.type) {
      filters.push(eq(workerType.worker_type_id, query.type));
    }

    return filters;
  };

  listChannels = async (
    perPage: number,
    currentPage: number,
    query: ListChannelsRequest
  ): Promise<ListChannelsResponse[]> => {
    const orders = this.setOrders(query);
    const filters = this.setFilters(query);

    const queryBuilder = this.db
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        type: {
          id: workerType.worker_type_id,
          name: workerType.type,
        },
        server: {
          id: server.server_id,
          name: server.name,
        },
        account: {
          id: account.account_id,
          name: account.name,
        },
        connection_date: worker.connection_date,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(
        and(isNull(worker.deleted_at), isNull(account.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListChannelsResponse[];
    }

    return result.map((item) => ({
      id: item.id,
      name: item.name,
      number: item.number,
      status: item.status,
      type: item.type,
      server: item.server,
      account: item.account,
      connection_date: item.connection_date,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  };

  listChannelsTotal = async (query: ListChannelsRequest): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(
        and(isNull(worker.deleted_at), isNull(account.deleted_at), ...filters)
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
