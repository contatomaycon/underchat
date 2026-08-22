import * as schema from '@core/models';
import { apiKey, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  SQL,
  SQLWrapper,
} from 'drizzle-orm';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';
import { ListIntegrationsItem } from '@core/schema/integration/listIntegrations/response.schema';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (
    accountId: string,
    query: ListIntegrationsRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [
      eq(apiKey.account_id, accountId),
      isNotNull(apiKey.worker_id),
    ];

    if (query.search) {
      filters.push(ilike(apiKey.name, `%${query.search}%`) as SQLWrapper);
    }

    if (query.status) {
      filters.push(eq(apiKey.status, query.status as EStatusApiKey));
    }

    return filters;
  };

  private readonly setOrders = (query: ListIntegrationsRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(desc(apiKey.created_at));

      return orders;
    }

    for (const { key, order } of sort) {
      if (key === 'name') {
        orders.push(
          order === ESortOrder.asc ? asc(apiKey.name) : desc(apiKey.name)
        );
      }
      if (key === 'status') {
        orders.push(
          order === ESortOrder.asc ? asc(apiKey.status) : desc(apiKey.status)
        );
      }
      if (key === 'created_at') {
        orders.push(
          order === ESortOrder.asc
            ? asc(apiKey.created_at)
            : desc(apiKey.created_at)
        );
      }
      if (key === 'updated_at') {
        orders.push(
          order === ESortOrder.asc
            ? asc(apiKey.updated_at)
            : desc(apiKey.updated_at)
        );
      }
    }

    return orders;
  };

  listIntegrations = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListIntegrationsRequest
  ): Promise<ListIntegrationsItem[]> => {
    const filters = this.setFilters(accountId, query);
    const orders = this.setOrders(query);

    const queryBuilder = this.dbRo
      .select({
        api_key_id: apiKey.api_key_id,
        name: apiKey.name,
        status: apiKey.status,
        worker_id: apiKey.worker_id,
        worker_name: worker.name,
      })
      .from(apiKey)
      .leftJoin(worker, eq(worker.worker_id, apiKey.worker_id))
      .where(and(isNull(apiKey.deleted_at), ...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => ({
      api_key_id: item.api_key_id,
      name: item.name,
      status: item.status,
      worker_id: item.worker_id,
      worker_name: item.worker_name,
    }));
  };

  listIntegrationsTotal = async (
    accountId: string,
    query: ListIntegrationsRequest
  ): Promise<number> => {
    const filters = this.setFilters(accountId, query);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(apiKey)
      .leftJoin(worker, eq(worker.worker_id, apiKey.worker_id))
      .where(and(isNull(apiKey.deleted_at), ...filters))
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };
}
