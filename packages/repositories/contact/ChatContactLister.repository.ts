import * as schema from '@core/models';
import { contact, labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  eq,
  ilike,
  isNull,
  or,
  SQLWrapper,
  sql,
  inArray,
} from 'drizzle-orm';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
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

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    search?: string
  ): Promise<ListChatContactsResponse[]> => {
    const whereConditions: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (search) {
      const searchConditions = this.buildSearchConditions(search);
      whereConditions.push(...searchConditions);
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
      .orderBy(asc(contact.name))
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
    search?: string
  ): Promise<number> => {
    const whereConditions: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (search) {
      const searchConditions = this.buildSearchConditions(search);
      whereConditions.push(...searchConditions);
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
