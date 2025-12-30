import * as schema from '@core/models';
import { contact, labelTemplate, account } from '@core/models';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewContactById = async (
    contactId: string,
    accountId?: string
  ): Promise<(ViewContactResponse & { phone: string }) | null> => {
    const conditions = [
      eq(contact.contact_id, contactId),
      isNull(contact.deleted_at),
    ];

    if (accountId) {
      conditions.push(eq(contact.account_id, accountId));
    }

    const result = await this.db
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
        phone: contact.phone,
        phone_ddi: contact.phone_ddi,
        phone_partial: contact.phone_partial,
        nickname: contact.nickname,
        photo: contact.photo,
        birthday: sql<
          string | null
        >`CASE WHEN ${contact.birthday} IS NULL THEN NULL ELSE to_char(${contact.birthday}, 'YYYY-MM-DD') END`,
        notes: contact.notes,
        created_at: contact.created_at,
        is_valided: contact.is_valided,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(labelTemplate.label_template_id, contact.label_template_id)
      )
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as (ViewContactResponse & { phone: string }) | null;
  };

  viewContactByPhone = async (
    accountId: string,
    phonesC: string[],
    phoneDdi: string
  ): Promise<ViewContactResponse | null> => {
    const conditions = [
      isNull(contact.deleted_at),
      eq(contact.account_id, accountId),
      inArray(contact.phone_c, phonesC),
      eq(contact.phone_ddi, phoneDdi),
    ];

    const result = await this.db
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
        photo: contact.photo,
        birthday: sql<
          string | null
        >`CASE WHEN ${contact.birthday} IS NULL THEN NULL ELSE to_char(${contact.birthday}, 'YYYY-MM-DD') END`,
        notes: contact.notes,
        created_at: contact.created_at,
        is_valided: contact.is_valided,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(labelTemplate.label_template_id, contact.label_template_id)
      )
      .where(and(...conditions))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as ViewContactResponse;
  };
}
