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
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { ESortByContact } from '@core/common/enums/ESortByContact';

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

    if (
      query.name ||
      query.email ||
      query.phone ||
      query.label_template ||
      query.nickname
    ) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(contact.name, `%${query.name}%`) : undefined,
        query.email
          ? ilike(contact.email_partial, `%${query.email}%`)
          : undefined,
        query.phone
          ? ilike(contact.phone_partial, `%${query.phone}%`)
          : undefined,
        query.nickname
          ? ilike(contact.nickname, `%${query.nickname}%`)
          : undefined,
        query.label_template
          ? inArray(
              labelTemplate.label_template_id,
              this.db
                .select({ label_template_id: labelTemplate.label_template_id })
                .from(labelTemplate)
                .where(ilike(labelTemplate.label, `%${query.label_template}%`))
            )
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
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
        email: contact.email,
        email_partial: contact.email_partial,
        phone_ddi: contact.phone_ddi,
        phone: contact.phone,
        phone_partial: contact.phone_partial,
        nickname: contact.nickname,
        birthday: contact.birthday,
        notes: contact.notes,
        created_at: contact.created_at,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(accountCondition, isNull(contact.deleted_at), ...filters));

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
      email: contact.email ?? null,
      email_partial: contact.email_partial ?? null,
      phone_ddi: contact.phone_ddi ?? null,
      phone: contact.phone ?? null,
      phone_partial: contact.phone_partial ?? null,
      created_at: contact.created_at ?? null,
      nickname: contact.nickname ?? null,
      birthday: contact.birthday ?? null,
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
      .where(and(accountCondition, isNull(contact.deleted_at), ...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
