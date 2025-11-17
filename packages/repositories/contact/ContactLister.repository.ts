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

function isDefined(condition: SQLWrapper | undefined): condition is SQLWrapper {
  return condition !== undefined;
}

@injectable()
export class ContactListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
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

  private readonly setFilters = (query: ListContactRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (!query.search) {
      return filters;
    }

    const searchTerm = query.search.trim();
    if (searchTerm.length === 0) {
      return filters;
    }

    const searchTermLength = searchTerm.length;
    const minSearchLength = 3;

    const rawConditions: Array<SQLWrapper | undefined> = [
      searchTermLength >= minSearchLength
        ? ilike(contact.name, `%${searchTerm}%`)
        : undefined,
      searchTermLength >= minSearchLength
        ? ilike(contact.nickname, `%${searchTerm}%`)
        : undefined,
      searchTermLength >= minSearchLength
        ? ilike(contact.email_partial, `%${searchTerm}%`)
        : undefined,
      searchTermLength >= minSearchLength
        ? ilike(contact.phone_partial, `%${searchTerm}%`)
        : undefined,
      searchTermLength >= minSearchLength
        ? inArray(
            labelTemplate.label_template_id,
            this.db
              .select({ label_template_id: labelTemplate.label_template_id })
              .from(labelTemplate)
              .where(ilike(labelTemplate.label, `%${searchTerm}%`))
          )
        : undefined,
    ];

    const conditions = rawConditions.filter(isDefined);

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
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListContactResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(contact.account_id, accountId);

    const whereConditions = [
      accountCondition,
      isNull(contact.deleted_at),
      ...filters,
    ].filter(isDefined);

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
    })) as ListContactResponse[];
  };

  listContactTotal = async (
    query: ListContactRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(contact.account_id, accountId);

    const whereConditions = [
      accountCondition,
      isNull(contact.deleted_at),
      ...filters,
    ].filter(isDefined);

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
