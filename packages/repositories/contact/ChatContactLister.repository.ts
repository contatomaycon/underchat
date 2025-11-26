import * as schema from '@core/models';
import { contact, labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, count, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';

@injectable()
export class ChatContactListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    search?: string
  ): Promise<ListChatContactsResponse[]> => {
    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (search) {
      const searchConditions = [
        ilike(contact.name, `%${search}%`),
        ilike(contact.email_partial, `%${search}%`),
        ilike(contact.phone_partial, `%${search}%`),
      ];
      whereConditions.push(or(...searchConditions) as SQL);
    }

    const result = await this.db
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
    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    if (search) {
      const searchConditions = [
        ilike(contact.name, `%${search}%`),
        ilike(contact.email_partial, `%${search}%`),
        ilike(contact.phone_partial, `%${search}%`),
      ];
      whereConditions.push(or(...searchConditions) as SQL);
    }

    const result = await this.db
      .select({
        count: count(),
      })
      .from(contact)
      .where(and(...whereConditions))
      .execute();

    return result[0]?.count ?? 0;
  };
}
