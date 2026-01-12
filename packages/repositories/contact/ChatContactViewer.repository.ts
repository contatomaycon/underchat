import * as schema from '@core/models';
import {
  contact,
  labelTemplate,
  contactDocumentType,
  user,
  userInfo,
} from '@core/models';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { ViewChatContactByPhoneResponse } from '@core/schema/chat/viewContactByPhone/response.schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ChatContactViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewChatContactById = async (
    contactId: string,
    accountId: string
  ): Promise<ViewChatContactResponse | null> => {
    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
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
        is_valided: contact.is_valided,
        ignore: contact.ignore,
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
        user: {
          user_id: user.user_id,
          name: sql<
            string | null
          >`CASE WHEN ${userInfo.name} IS NULL OR ${userInfo.last_name} IS NULL THEN NULL ELSE CONCAT(${userInfo.name}, ' ', ${userInfo.last_name}) END`,
          photo: userInfo.photo,
        },
      })
      .from(contact)
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
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
      .where(
        and(
          eq(contact.contact_id, contactId),
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at)
        )
      )
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

    return formattedResult as ViewChatContactResponse;
  };

  viewChatContactByPhone = async (
    accountId: string,
    phonesC: string[],
    phoneDdi: string
  ): Promise<ViewChatContactByPhoneResponse | null> => {
    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
      })
      .from(contact)
      .where(
        and(
          eq(contact.account_id, accountId),
          inArray(contact.phone_c, phonesC),
          eq(contact.phone_ddi, phoneDdi),
          isNull(contact.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };

  viewChatContactsByIds = async (
    contactIds: string[],
    accountId: string
  ): Promise<ViewChatContactResponse[]> => {
    if (!contactIds.length) {
      return [];
    }

    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
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
        is_valided: contact.is_valided,
        ignore: contact.ignore,
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
        user: {
          user_id: user.user_id,
          name: sql<
            string | null
          >`CASE WHEN ${userInfo.name} IS NULL OR ${userInfo.last_name} IS NULL THEN NULL ELSE CONCAT(${userInfo.name}, ' ', ${userInfo.last_name}) END`,
          photo: userInfo.photo,
        },
      })
      .from(contact)
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
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
      .where(
        and(
          inArray(contact.contact_id, contactIds),
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at)
        )
      )
      .execute();

    return result.map((contactData: any) => ({
      ...contactData,
      user: contactData.user?.user_id
        ? {
            user_id: contactData.user.user_id,
            name: contactData.user.name,
            photo: contactData.user.photo,
          }
        : null,
    })) as ViewChatContactResponse[];
  };
}
