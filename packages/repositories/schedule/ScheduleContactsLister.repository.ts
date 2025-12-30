import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  SQL,
  SQLWrapper,
  or,
  ilike,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListScheduleContactsResponse } from '@core/schema/schedule/listScheduleContacts/response.schema';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';

@injectable()
export class ScheduleContactsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListScheduleContactsRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(asc(contact.name), desc(contact.contact_id));

      return orders;
    }

    for (const { key, order } of sort) {
      if (key === 'name') {
        orders.push(
          order === ESortOrder.asc ? asc(contact.name) : desc(contact.name)
        );
      }
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListScheduleContactsRequest,
    accountId: string
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (query.search) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.search ? ilike(contact.name, `%${query.search}%`) : undefined,
        query.search
          ? ilike(contact.phone_partial, `%${query.search}%`)
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    return filters;
  };

  listScheduleContacts = async (
    perPage: number,
    currentPage: number,
    query: ListScheduleContactsRequest,
    accountId: string
  ): Promise<ListScheduleContactsResponse[]> => {
    const filters = this.setFilters(query, accountId);
    const orders = this.setOrders(query);

    const queryBuilder = this.dbRo
      .select({
        contact_id: contact.contact_id,
        name: contact.name,
        last_name: contact.last_name,
        phone_partial: contact.phone_partial,
      })
      .from(contact)
      .where(and(...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListScheduleContactsResponse[];
    }

    return result.map((item) => ({
      contact_id: item.contact_id,
      name: item.name,
      last_name: item.last_name ?? null,
      phone_partial: item.phone_partial ?? null,
    })) as ListScheduleContactsResponse[];
  };

  listScheduleContactsTotal = async (
    query: ListScheduleContactsRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query, accountId);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(contact)
      .where(and(...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
