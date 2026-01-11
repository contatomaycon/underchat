import * as schema from '@core/models';
import { contact, labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  SQL,
  SQLWrapper,
  sql,
  inArray,
} from 'drizzle-orm';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatContactsRequest } from '@core/schema/chat/listContacts/request.schema';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

@injectable()
export class ChatContactListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly buildSearchConditions = (
    searchTerm: string
  ): SQLWrapper[] => {
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
      searchTerm
        ? inArray(
            labelTemplate.label_template_id,
            this.dbRo
              .select({ label_template_id: labelTemplate.label_template_id })
              .from(labelTemplate)
              .where(ilike(labelTemplate.label, `%${searchTerm}%`))
          )
        : undefined,
    ];

    const conditions = rawConditions.filter(isDefinedFilter);

    return conditions.length > 0 ? [or(...conditions) as SQLWrapper] : [];
  };

  private readonly buildAdvancedFilters = (
    filters: Omit<ListChatContactsRequest, 'current_page' | 'per_page'>,
    emailHash: string | null,
    phoneHashes: string[] | null,
    documentHash: string | null
  ): SQLWrapper[] => {
    const filterConditions: Array<SQLWrapper | undefined> = [];

    if (filters.filter_label_template_id) {
      filterConditions.push(
        eq(contact.label_template_id, filters.filter_label_template_id)
      );
    }

    if (filters.filter_phone_ddi) {
      filterConditions.push(eq(contact.phone_ddi, filters.filter_phone_ddi));
    }

    if (filters.filter_phone && phoneHashes && phoneHashes.length > 0) {
      filterConditions.push(inArray(contact.phone_c, phoneHashes));
    }

    if (filters.filter_name) {
      filterConditions.push(ilike(contact.name, `%${filters.filter_name}%`));
    }

    if (filters.filter_last_name) {
      filterConditions.push(
        ilike(contact.last_name, `%${filters.filter_last_name}%`)
      );
    }

    if (filters.filter_nickname) {
      filterConditions.push(
        ilike(contact.nickname, `%${filters.filter_nickname}%`)
      );
    }

    if (filters.filter_email && emailHash) {
      filterConditions.push(eq(contact.email_c, emailHash));
    }

    if (filters.filter_birthday) {
      filterConditions.push(
        sql`DATE(${contact.birthday}) = DATE(${sql.raw(`'${filters.filter_birthday}'`)}::timestamp)`
      );
    }

    if (filters.filter_document && documentHash) {
      filterConditions.push(eq(contact.document_c, documentHash));
    }

    if (filters.filter_user_id) {
      filterConditions.push(eq(contact.user_id, filters.filter_user_id));
    }

    return filterConditions.filter(isDefinedFilter);
  };

  private readonly buildOrderBy = (
    sortField?: string | null,
    sortOrder?: string | null
  ): SQL => {
    const order = sortOrder === 'desc' ? desc : asc;

    if (sortField === 'name') {
      return order(contact.name);
    }
    if (sortField === 'last_name') {
      return order(contact.last_name);
    }
    if (sortField === 'nickname') {
      return order(contact.nickname);
    }
    if (sortField === 'email') {
      return order(contact.email_partial);
    }
    if (sortField === 'phone') {
      return order(contact.phone_partial);
    }
    if (sortField === 'label') {
      return order(labelTemplate.label);
    }
    if (sortField === 'birthday') {
      return order(contact.birthday);
    }

    return asc(contact.name);
  };

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    query?: ListChatContactsRequest,
    emailHash?: string | null,
    phoneHashes?: string[] | null,
    documentHash?: string | null
  ): Promise<ListChatContactsResponse[]> => {
    const whereConditions: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (query?.search) {
      const searchConditions = this.buildSearchConditions(query.search);
      whereConditions.push(...searchConditions);
    }

    if (query) {
      const advancedFilters = this.buildAdvancedFilters(
        query,
        emailHash ?? null,
        phoneHashes ?? null,
        documentHash ?? null
      );
      whereConditions.push(...advancedFilters);
    }

    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
        name: contact.name,
        last_name: contact.last_name,
        email_partial: contact.email_partial,
        phone_partial: contact.phone_partial,
        photo: contact.photo,
        is_valided: contact.is_valided,
        label_template: {
          label_template_id: labelTemplate.label_template_id,
          label: labelTemplate.label,
          color: labelTemplate.color,
        },
      })
      .from(contact)
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(...whereConditions))
      .orderBy(this.buildOrderBy(query?.sort_field, query?.sort_order))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((contact) => ({
      contact_id: contact.contact_id,
      name: contact.name,
      last_name: contact.last_name ?? null,
      email_partial: contact.email_partial ?? null,
      phone_partial: contact.phone_partial ?? null,
      photo: contact.photo ?? null,
      is_valided: contact.is_valided ?? null,
      label_template: contact.label_template?.label_template_id
        ? {
            label_template_id: contact.label_template.label_template_id,
            label: contact.label_template.label,
            color: contact.label_template.color,
          }
        : null,
    }));
  };

  listChatContactsTotal = async (
    accountId: string,
    query?: ListChatContactsRequest,
    emailHash?: string | null,
    phoneHashes?: string[] | null,
    documentHash?: string | null
  ): Promise<number> => {
    const whereConditions: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (query?.search) {
      const searchConditions = this.buildSearchConditions(query.search);
      whereConditions.push(...searchConditions);
    }

    if (query) {
      const advancedFilters = this.buildAdvancedFilters(
        query,
        emailHash ?? null,
        phoneHashes ?? null,
        documentHash ?? null
      );
      whereConditions.push(...advancedFilters);
    }

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(contact)
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(...whereConditions))
      .execute();

    return result[0]?.count ?? 0;
  };
}
