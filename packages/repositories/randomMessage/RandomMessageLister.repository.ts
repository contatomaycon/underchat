import * as schema from '@core/models';
import { randomMessage } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, count, desc, eq, ilike, SQL, SQLWrapper } from 'drizzle-orm';
import { ListRandomMessageRequest } from '@core/schema/randomMessage/listRandomMessage/request.schema';
import { ListRandomMessageResponse } from '@core/schema/randomMessage/listRandomMessage/response.schema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';

@injectable()
export class RandomMessageListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListRandomMessageRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        desc(randomMessage.created_at),
        desc(randomMessage.random_message_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key === 'name') {
        orders.push(
          order === 'asc' ? asc(randomMessage.name) : desc(randomMessage.name)
        );
      }

      if (key === 'status') {
        orders.push(
          order === 'asc'
            ? asc(randomMessage.status)
            : desc(randomMessage.status)
        );
      }

      if (key === 'created_at') {
        orders.push(
          order === 'asc'
            ? asc(randomMessage.created_at)
            : desc(randomMessage.created_at)
        );
      }
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListRandomMessageRequest,
    accountId: string
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [eq(randomMessage.account_id, accountId)];

    if (query.name) {
      filters.push(ilike(randomMessage.name, `%${query.name}%`));
    }

    if (query.status) {
      filters.push(eq(randomMessage.status, query.status));
    }

    return filters;
  };

  listRandomMessages = async (
    perPage: number,
    currentPage: number,
    query: ListRandomMessageRequest,
    accountId: string
  ): Promise<ListRandomMessageResponse[]> => {
    const filters = this.setFilters(query, accountId);
    const orders = this.setOrders(query);

    const queryBuilder = this.dbRo
      .select({
        random_message_id: randomMessage.random_message_id,
        name: randomMessage.name,
        status: randomMessage.status,
        created_at: randomMessage.created_at,
      })
      .from(randomMessage)
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

    return result as ListRandomMessageResponse[];
  };

  listRandomMessageTotal = async (
    query: ListRandomMessageRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query, accountId);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(randomMessage)
      .where(and(...filters))
      .execute();

    return result[0]?.count ?? 0;
  };

  listActiveRandomMessagesForChatbot = async (
    accountId: string
  ): Promise<Array<{ random_message_id: string; name: string }>> => {
    const result = await this.dbRo
      .select({
        random_message_id: randomMessage.random_message_id,
        name: randomMessage.name,
      })
      .from(randomMessage)
      .where(
        and(
          eq(randomMessage.account_id, accountId),
          eq(randomMessage.status, ERandomMessageStatus.active)
        )
      )
      .orderBy(asc(randomMessage.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as Array<{ random_message_id: string; name: string }>;
  };
}
