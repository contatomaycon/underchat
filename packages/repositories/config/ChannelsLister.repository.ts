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
  ne,
  SQLWrapper,
  count,
  SQL,
  or,
} from 'drizzle-orm';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { IConfigChannelRecreateTarget } from '@core/common/interfaces/IConfigChannelRecreateTarget';
import { EWorkerType } from '@core/common/enums/EWorkerType';

@injectable()
export class ChannelsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly buildNameOrNumberFilter = (
    name?: string | null,
    number?: string | null
  ): SQLWrapper | undefined => {
    const filters = [
      name ? ilike(worker.name, `%${name}%`) : undefined,
      number ? ilike(worker.number, `%${number}%`) : undefined,
    ].filter((filter): filter is SQL => Boolean(filter));

    if (!filters.length) {
      return undefined;
    }

    return or(...filters);
  };

  private readonly setOrders = (query: ListChannelsRequest): SQL[] => {
    if (!query.sort_by?.length) {
      return [];
    }

    const mapping: Record<string, SQLWrapper> = {
      name: worker.name,
      number: worker.number,
      status: workerStatus.status,
      type: workerType.type,
      account: account.name,
      server: server.name,
      connection_date: worker.connection_date,
      created_at: worker.created_at,
    };

    const orders: SQL[] = [];

    for (const sort of query.sort_by) {
      const column = mapping[sort.key];
      if (!column) continue;

      const order = sort.order === 'asc' ? asc(column) : desc(column);
      orders.push(order);
    }

    return orders;
  };

  private readonly setFilters = (query: ListChannelsRequest): SQLWrapper[] => {
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

    const searchFilter = this.buildNameOrNumberFilter(query.name, query.number);
    if (searchFilter) {
      filters.push(searchFilter);
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

    const queryBuilder = this.dbRo
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
        last_connection_check_at: worker.last_connection_check_at,
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
      last_connection_check_at: item.last_connection_check_at,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  };

  listChannelsTotal = async (query: ListChannelsRequest): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.dbRo
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

  listAllNonDeletedChannelIds = async (
    filtersInput: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<string[]> => {
    const targets =
      await this.listAllNonDeletedChannelRecreateTargets(filtersInput);

    return targets.map((item) => item.worker_id);
  };

  listAllNonDeletedChannelRecreateTargets = async (
    filtersInput: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<IConfigChannelRecreateTarget[]> => {
    const filters: SQLWrapper[] = [
      isNull(worker.deleted_at),
      isNull(account.deleted_at),
      ne(workerType.worker_type_id, EWorkerType.whatsapp),
    ];

    if (filtersInput.status) {
      filters.push(eq(workerStatus.worker_status_id, filtersInput.status));
    }

    if (filtersInput.type) {
      filters.push(eq(workerType.worker_type_id, filtersInput.type));
    }

    if (filtersInput.account) {
      filters.push(eq(account.account_id, filtersInput.account));
    }

    const searchFilter = this.buildNameOrNumberFilter(
      filtersInput.name,
      filtersInput.number
    );
    if (searchFilter) {
      filters.push(searchFilter);
    }

    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        server_id: worker.server_id,
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .where(and(...filters))
      .execute();

    return result.map((item) => ({
      worker_id: item.worker_id,
      server_id: item.server_id,
    }));
  };
}
