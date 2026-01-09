import * as schema from '@core/models';
import {
  contact,
  labelTemplate,
  account,
  contactDocumentType,
  user,
  userInfo,
} from '@core/models';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
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

    const result = await this.dbRo
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
        contact_document_type: {
          contact_document_type_id:
            contactDocumentType.contact_document_type_id,
          name: contactDocumentType.name,
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
        document: contact.document,
        document_partial: contact.document_partial,
        created_at: contact.created_at,
        is_valided: contact.is_valided,
        user: {
          user_id: user.user_id,
          name: sql<
            string | null
          >`CASE WHEN ${userInfo.name} IS NULL OR ${userInfo.last_name} IS NULL THEN NULL ELSE CONCAT(${userInfo.name}, ' ', ${userInfo.last_name}) END`,
          photo: userInfo.photo,
        },
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(labelTemplate.label_template_id, contact.label_template_id)
      )
      .leftJoin(
        contactDocumentType,
        eq(
          contactDocumentType.contact_document_type_id,
          contact.contact_document_type_id
        )
      )
      .leftJoin(user, eq(contact.user_id, user.user_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return null;
    }

    const contactData = result[0] as any;
    const formattedResult = {
      ...contactData,
      user: contactData.user?.user_id
        ? {
            user_id: contactData.user.user_id,
            name: contactData.user.name,
            photo: contactData.user.photo,
          }
        : null,
    };

    return formattedResult as (ViewContactResponse & { phone: string }) | null;
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

    const result = await this.dbRo
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
        contact_document_type: {
          contact_document_type_id:
            contactDocumentType.contact_document_type_id,
          name: contactDocumentType.name,
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
        document: contact.document,
        document_partial: contact.document_partial,
        created_at: contact.created_at,
        is_valided: contact.is_valided,
        user: {
          user_id: user.user_id,
          name: sql<
            string | null
          >`CASE WHEN ${userInfo.name} IS NULL OR ${userInfo.last_name} IS NULL THEN NULL ELSE CONCAT(${userInfo.name}, ' ', ${userInfo.last_name}) END`,
          photo: userInfo.photo,
        },
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(labelTemplate.label_template_id, contact.label_template_id)
      )
      .leftJoin(
        contactDocumentType,
        eq(
          contactDocumentType.contact_document_type_id,
          contact.contact_document_type_id
        )
      )
      .leftJoin(user, eq(contact.user_id, user.user_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(and(...conditions))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    const contactData = result[0] as any;
    const formattedResult = {
      ...contactData,
      user: contactData.user?.user_id
        ? {
            user_id: contactData.user.user_id,
            name: contactData.user.name,
            photo: contactData.user.photo,
          }
        : null,
    };

    return formattedResult as ViewContactResponse;
  };
}
