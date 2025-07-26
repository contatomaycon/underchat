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
  like,
  count,
} from 'drizzle-orm';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ESortByWorker } from '@core/common/enums/ESortByWorker';
import { ESortOrder } from '@core/common/enums/ESortOrder';

@injectable()
export class WorkerListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListWorkerRequest): SQL[] => {
    const orders: SQL[] = [];

    if (query.sort_by?.length) {
      query.sort_by.forEach(({ key, order }) => {
        if (key === ESortByWorker.name)
          orders.push(
            order === ESortOrder.asc ? asc(worker.name) : desc(worker.name)
          );

        if (key === ESortByWorker.account)
          orders.push(
            order === ESortOrder.asc ? asc(account.name) : desc(account.name)
          );

        if (key === ESortByWorker.server)
          orders.push(
            order === ESortOrder.asc ? asc(server.name) : desc(server.name)
          );

        if (key === ESortByWorker.status)
          orders.push(
            order === ESortOrder.asc
              ? asc(workerStatus.status)
              : desc(workerStatus.status)
          );

        if (key === ESortByWorker.type)
          orders.push(
            order === ESortOrder.asc
              ? asc(workerType.type)
              : desc(workerType.type)
          );

        if (key === ESortByWorker.updated_at)
          orders.push(
            order === ESortOrder.asc
              ? asc(worker.updated_at)
              : desc(worker.updated_at)
          );
      });
    }

    if (!query.sort_by?.length) {
      orders.push(asc(worker.created_at), desc(worker.worker_id));
    }

    return orders;
  };

  private readonly setFilters = (query: ListWorkerRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name) {
      filters.push(like(worker.name, `%${query.name}%`));
    }

    if (query.status) {
      filters.push(eq(workerStatus.worker_status_id, query.status));
    }

    if (query.type) {
      filters.push(eq(workerType.worker_type_id, query.type));
    }

    if (query.server) {
      filters.push(eq(server.server_id, query.server));
    }

    if (query.account) {
      filters.push(eq(account.name, query.account));
    }

    return filters;
  };

  listWorker = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<ListWorkerResponse[]> => {
    const orders = this.setOrders(query);
    const filters = this.setFilters(query);

    const queryBuilder = this.db
      .select({
        id: worker.worker_id,
        name: worker.name,
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
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          ...filters
        )
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListWorkerResponse[];
    }

    return result as ListWorkerResponse[];
  };

  listWorkerTotal = async (
    accountId: string,
    query: ListWorkerRequest
  ): Promise<number> => {
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
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          ...filters
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
