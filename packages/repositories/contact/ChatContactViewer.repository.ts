import * as schema from '@core/models';
import { contact, labelTemplate, contactDocumentType } from '@core/models';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
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

    return result[0] as ViewChatContactResponse;
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
      .where(
        and(
          inArray(contact.contact_id, contactIds),
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at)
        )
      )
      .execute();

    return result as ViewChatContactResponse[];
  };
}
