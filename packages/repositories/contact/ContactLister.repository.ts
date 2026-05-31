import * as schema from '@core/models';
import {
  contact,
  labelTemplate,
  account,
  contactLabelTemplate,
  user,
  userInfo,
} from '@core/models';
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
  notExists,
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
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
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

    if (query.user_id) {
      filters.push(eq(contact.user_id, query.user_id));
    }

    if (query.filter_without_label_template === true) {
      filters.push(
        notExists(
          this.dbRo
            .select()
            .from(contactLabelTemplate)
            .innerJoin(
              labelTemplate,
              eq(
                labelTemplate.label_template_id,
                contactLabelTemplate.label_template_id
              )
            )
            .where(
              and(
                eq(contactLabelTemplate.contact_id, contact.contact_id),
                isNull(labelTemplate.deleted_at)
              )
            )
        )
      );
    } else if (query.filter_label_template_id) {
      filters.push(
        inArray(
          contact.contact_id,
          this.dbRo
            .select({ contact_id: contactLabelTemplate.contact_id })
            .from(contactLabelTemplate)
            .innerJoin(
              labelTemplate,
              eq(
                labelTemplate.label_template_id,
                contactLabelTemplate.label_template_id
              )
            )
            .where(
              and(
                eq(
                  contactLabelTemplate.label_template_id,
                  query.filter_label_template_id
                ),
                isNull(labelTemplate.deleted_at)
              )
            )
        )
      );
    }

    const searchTerm = query.search;
    if (!searchTerm) return filters;

    const searchWords = searchTerm
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const hasMultipleWords = searchWords.length > 1;

    const rawConditions: Array<SQLWrapper | undefined> = [
      searchTerm ? ilike(contact.name, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.last_name, `%${searchTerm}%`) : undefined,
      hasMultipleWords
        ? and(
            ilike(contact.name, `%${searchWords[0]}%`),
            ilike(contact.last_name, `%${searchWords[1]}%`)
          )
        : undefined,
      hasMultipleWords
        ? and(
            ilike(contact.name, `%${searchWords[1]}%`),
            ilike(contact.last_name, `%${searchWords[0]}%`)
          )
        : undefined,
      searchTerm
        ? ilike(
            sql`CONCAT(COALESCE(${contact.name}, ''), ' ', COALESCE(${contact.last_name}, ''))`,
            `%${searchTerm}%`
          )
        : undefined,
      searchTerm ? ilike(contact.nickname, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.email_partial, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.phone_partial, `%${searchTerm}%`) : undefined,
      searchHashes ? eq(contact.email_c, searchHashes) : undefined,
      searchHashes ? eq(contact.phone_c, searchHashes) : undefined,
      searchTerm
        ? inArray(
            contact.contact_id,
            this.dbRo
              .select({ contact_id: contactLabelTemplate.contact_id })
              .from(contactLabelTemplate)
              .innerJoin(
                labelTemplate,
                eq(
                  labelTemplate.label_template_id,
                  contactLabelTemplate.label_template_id
                )
              )
              .where(
                and(
                  ilike(labelTemplate.label, `%${searchTerm}%`),
                  isNull(labelTemplate.deleted_at)
                )
              )
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

    const contactsResult = await this.findContacts(
      accountId,
      filters,
      orders,
      perPage,
      currentPage
    );

    if (!contactsResult?.length) {
      return [] as ListContactResponse[];
    }

    const contactIds = contactsResult.map((c) => c.contact_id);
    const labelsByContactId = await this.findLabelsByContactIds(contactIds);

    return this.buildListContactResponse(contactsResult, labelsByContactId);
  };

  private readonly findContacts = async (
    accountId: string,
    filters: SQLWrapper[],
    orders: SQL[],
    perPage: number,
    currentPage: number
  ) => {
    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
      ...filters,
    ].filter(isDefinedFilter);

    const queryBuilder = this.dbRo
      .select({
        contact_id: contact.contact_id,
        account: {
          account_id: account.account_id,
          name: account.name,
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
        user_id: user.user_id,
        user_name: sql<
          string | null
        >`TRIM(CONCAT(COALESCE(${userInfo.name}, ''), ' ', COALESCE(${userInfo.last_name}, '')))`,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(user, eq(contact.user_id, user.user_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(and(...whereConditions));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    return queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();
  };

  private readonly findLabelsByContactIds = async (
    contactIds: string[]
  ): Promise<
    Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >
  > => {
    if (contactIds.length === 0) {
      return new Map();
    }

    const labelsResult = await this.dbRo
      .select({
        contact_id: contactLabelTemplate.contact_id,
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(contactLabelTemplate)
      .innerJoin(
        labelTemplate,
        eq(
          labelTemplate.label_template_id,
          contactLabelTemplate.label_template_id
        )
      )
      .where(
        and(
          inArray(contactLabelTemplate.contact_id, contactIds),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    return this.buildLabelsMap(labelsResult);
  };

  private readonly buildLabelsMap = (
    labelsResult: Array<{
      contact_id: string;
      label_template_id: string;
      label: string;
      color: string;
    }>
  ): Map<
    string,
    Array<{ label_template_id: string; label: string; color: string }>
  > => {
    const labelsByContactId = new Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >();

    for (const label of labelsResult) {
      const existing = labelsByContactId.get(label.contact_id) ?? [];
      existing.push({
        label_template_id: label.label_template_id,
        label: label.label,
        color: label.color,
      });
      labelsByContactId.set(label.contact_id, existing);
    }

    return labelsByContactId;
  };

  private readonly buildListContactResponse = (
    contactsResult: Array<{
      contact_id: string;
      account: { account_id: string; name: string } | null;
      name: string;
      last_name: string | null;
      email_partial: string | null;
      phone_ddi: string | null;
      phone_partial: string | null;
      nickname: string | null;
      birthday: string | null;
      notes: string | null;
      created_at: string | null;
      is_valided: boolean | null;
      photo: string | null;
      user_id: string | null;
      user_name: string | null;
    }>,
    labelsByContactId: Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >
  ): ListContactResponse[] => {
    return contactsResult.map((contactItem) => ({
      contact_id: contactItem.contact_id,
      account: {
        account_id: contactItem.account?.account_id,
        name: contactItem.account?.name,
      },
      label_templates: labelsByContactId.get(contactItem.contact_id) ?? [],
      name: contactItem.name,
      last_name: contactItem.last_name ?? null,
      email_partial: contactItem.email_partial ?? null,
      phone_ddi: contactItem.phone_ddi ?? null,
      phone_partial: contactItem.phone_partial ?? null,
      created_at: contactItem.created_at ?? null,
      nickname: contactItem.nickname ?? null,
      birthday: contactItem.birthday,
      notes: contactItem.notes ?? null,
      is_valided: contactItem.is_valided ?? null,
      photo: contactItem.photo ?? null,
      responsible_attendant:
        contactItem.user_id && contactItem.user_name
          ? {
              user_id: contactItem.user_id,
              name: contactItem.user_name.trim(),
            }
          : null,
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

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .where(and(...whereConditions))
      .execute();

    return result[0]?.count ?? 0;
  };
}
