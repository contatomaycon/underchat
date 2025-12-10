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
  asc,
  desc,
  eq,
  ilike,
  isNull,
  SQLWrapper,
  count,
  SQL,
} from 'drizzle-orm';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

@injectable()
export class ChannelsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private setOrders = (query: ListChannelsRequest): SQL[] => {
    const orders: SQL[] = [];

    if (query.sort_by?.length) {
      query.sort_by.forEach((sort: SortRequest) => {
        if (sort.key === 'name') {
          orders.push(
            sort.order === 'asc' ? asc(worker.name) : desc(worker.name)
          );
        }

        if (sort.key === 'number') {
          orders.push(
            sort.order === 'asc' ? asc(worker.number) : desc(worker.number)
          );
        }

        if (sort.key === 'status') {
          orders.push(
            sort.order === 'asc'
              ? asc(workerStatus.status)
              : desc(workerStatus.status)
          );
        }

        if (sort.key === 'type') {
          orders.push(
            sort.order === 'asc' ? asc(workerType.type) : desc(workerType.type)
          );
        }

        if (sort.key === 'account') {
          orders.push(
            sort.order === 'asc' ? asc(account.name) : desc(account.name)
          );
        }

        if (sort.key === 'server') {
          orders.push(
            sort.order === 'asc' ? asc(server.name) : desc(server.name)
          );
        }

        if (sort.key === 'connection_date') {
          orders.push(
            sort.order === 'asc'
              ? asc(worker.connection_date)
              : desc(worker.connection_date)
          );
        }

        if (sort.key === 'created_at') {
          orders.push(
            sort.order === 'asc'
              ? asc(worker.created_at)
              : desc(worker.created_at)
          );
        }
      });
    }

    return orders;
  };

  private setFilters = (query: ListChannelsRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.status) {
      filters.push(eq(workerStatus.worker_status_id, query.status));
    }

    if (query.type) {
      filters.push(eq(workerType.worker_type_id, query.type));
    }

    if (query.account) {
      filters.push(eq(account.account_id, query.account));
    }

    if (query.name) {
      filters.push(ilike(worker.name, `%${query.name}%`));
    }

    if (query.number) {
      filters.push(ilike(worker.number, `%${query.number}%`));
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

  listAllNonDeletedChannelIds = async (): Promise<string[]> => {
    const result = await this.db
      .select({
        worker_id: worker.worker_id,
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(and(isNull(worker.deleted_at), isNull(account.deleted_at)))
      .execute();

    return result.map((item) => item.worker_id);
  };
}
