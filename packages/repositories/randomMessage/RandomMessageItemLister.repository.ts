import * as schema from '@core/models';
import { randomMessageItem } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, count, desc, eq, ilike, SQL, SQLWrapper } from 'drizzle-orm';
import { ListRandomMessageItemQueryRequest } from '@core/schema/randomMessage/listRandomMessageItem/request.schema';
import { ListRandomMessageItemResponse } from '@core/schema/randomMessage/listRandomMessageItem/response.schema';

@injectable()
export class RandomMessageItemListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (
    query: ListRandomMessageItemQueryRequest
  ): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        desc(randomMessageItem.created_at),
        desc(randomMessageItem.random_message_item_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key === 'message') {
        orders.push(
          order === 'asc'
            ? asc(randomMessageItem.message)
            : desc(randomMessageItem.message)
        );
      }

      if (key === 'status') {
        orders.push(
          order === 'asc'
            ? asc(randomMessageItem.status)
            : desc(randomMessageItem.status)
        );
      }

      if (key === 'created_at') {
        orders.push(
          order === 'asc'
            ? asc(randomMessageItem.created_at)
            : desc(randomMessageItem.created_at)
        );
      }
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListRandomMessageItemQueryRequest,
    randomMessageId: string,
    accountId: string
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [
      eq(randomMessageItem.random_message_id, randomMessageId),
      eq(randomMessageItem.account_id, accountId),
    ];

    if (query.message) {
      filters.push(ilike(randomMessageItem.message, `%${query.message}%`));
    }

    if (query.status) {
      filters.push(eq(randomMessageItem.status, query.status));
    }

    return filters;
  };

  listRandomMessageItems = async (
    perPage: number,
    currentPage: number,
    query: ListRandomMessageItemQueryRequest,
    randomMessageId: string,
    accountId: string
  ): Promise<ListRandomMessageItemResponse[]> => {
    const filters = this.setFilters(query, randomMessageId, accountId);
    const orders = this.setOrders(query);

    const queryBuilder = this.dbRo
      .select({
        random_message_item_id: randomMessageItem.random_message_item_id,
        random_message_id: randomMessageItem.random_message_id,
        message: randomMessageItem.message,
        status: randomMessageItem.status,
        type: randomMessageItem.type,
        attachment_url: randomMessageItem.attachment_url,
        created_at: randomMessageItem.created_at,
      })
      .from(randomMessageItem)
      .where(and(...filters));

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

    return result as ListRandomMessageItemResponse[];
  };

  listRandomMessageItemTotal = async (
    query: ListRandomMessageItemQueryRequest,
    randomMessageId: string,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query, randomMessageId, accountId);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(randomMessageItem)
      .where(and(...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
