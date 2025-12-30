import * as schema from '@core/models';
import { contact, labelTemplate, account } from '@core/models';
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
  inArray,
  sql,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { ESortByContact } from '@core/common/enums/ESortByContact';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

@injectable()
export class ContactListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListContactRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(asc(contact.created_at), desc(contact.contact_id));

      return orders;
    }

    for (const { key, order } of sort) {
      if (key !== ESortByContact.name) continue;
      orders.push(
        order === ESortOrder.asc ? asc(contact.name) : desc(contact.name)
      );
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListContactRequest,
    searchHashes: string | null
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    const searchTerm = query.search;
    if (!searchTerm) return filters;

    const rawConditions: Array<SQLWrapper | undefined> = [
      searchTerm ? ilike(contact.name, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.nickname, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.email_partial, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.phone_partial, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.phone_partial, `%${searchTerm}%`) : undefined,
      searchHashes ? eq(contact.email_c, searchHashes) : undefined,
      searchHashes ? eq(contact.phone_c, searchHashes) : undefined,
      searchTerm
        ? inArray(
            labelTemplate.label_template_id,
            this.db
              .select({ label_template_id: labelTemplate.label_template_id })
              .from(labelTemplate)
              .where(ilike(labelTemplate.label, `%${searchTerm}%`))
          )
        : undefined,
    ];

    const conditions = rawConditions.filter(isDefinedFilter);

    if (conditions.length) {
      const combinedFilter = or(...conditions) as SQLWrapper;
      filters.push(combinedFilter);
    }

    return filters;
  };

  listContacts = async (
    perPage: number,
    currentPage: number,
    query: ListContactRequest,
    accountId: string,
    searchHashes: string | null
  ): Promise<ListContactResponse[]> => {
    const filters = this.setFilters(query, searchHashes);
    const orders = this.setOrders(query);

    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
      ...filters,
    ].filter(isDefinedFilter);

    const queryBuilder = this.db
      .select({
        contact_id: contact.contact_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        label_template: {
          label_template_id: labelTemplate.label_template_id,
          label: labelTemplate.label,
          color: labelTemplate.color,
        },
        name: contact.name,
        last_name: contact.last_name,
        email_partial: contact.email_partial,
        phone_ddi: contact.phone_ddi,
        phone_partial: contact.phone_partial,
        nickname: contact.nickname,
        birthday: sql<
          string | null
        >`CASE WHEN ${contact.birthday} IS NULL THEN NULL ELSE to_char(${contact.birthday}, 'YYYY-MM-DD') END`,
        notes: contact.notes,
        created_at: contact.created_at,
        is_valided: contact.is_valided,
        photo: contact.photo,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(...whereConditions));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListContactResponse[];
    }

    return result.map((contact) => ({
      contact_id: contact.contact_id,
      account: {
        account_id: contact.account?.account_id,
        name: contact.account?.name,
      },
      label_template: contact.label_template?.label_template_id
        ? {
            label_template_id: contact.label_template.label_template_id,
            label: contact.label_template.label,
            color: contact.label_template.color,
          }
        : null,
      name: contact.name,
      last_name: contact.last_name ?? null,
      email_partial: contact.email_partial ?? null,
      phone_ddi: contact.phone_ddi ?? null,
      phone_partial: contact.phone_partial ?? null,
      created_at: contact.created_at ?? null,
      nickname: contact.nickname ?? null,
      birthday: contact.birthday,
      notes: contact.notes ?? null,
      is_valided: contact.is_valided ?? null,
      photo: contact.photo ?? null,
    })) as ListContactResponse[];
  };

  listContactTotal = async (
    query: ListContactRequest,
    accountId: string,
    searchHashes: string | null
  ): Promise<number> => {
    const filters = this.setFilters(query, searchHashes);

    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
      ...filters,
    ].filter(isDefinedFilter);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(...whereConditions))
      .execute();

    return result[0]?.count ?? 0;
  };
}
