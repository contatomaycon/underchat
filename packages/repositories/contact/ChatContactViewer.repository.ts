import * as schema from '@core/models';
import {
  contact,
  labelTemplate,
  contactDocumentType,
  contactLabelTemplate,
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
    const [contactData, labels] = await Promise.all([
      this.findChatContactById(contactId, accountId),
      this.findLabelsByContactId(contactId),
    ]);

    if (!contactData) {
      return null;
    }

    return this.buildChatContactResponse(contactData, labels);
  };

  private readonly findChatContactById = async (
    contactId: string,
    accountId: string
  ) => {
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
      .limit(1)
      .execute();

    return result[0] ?? null;
  };

  private readonly findLabelsByContactId = async (contactId: string) => {
    const result = await this.dbRo
      .select({
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
      .where(eq(contactLabelTemplate.contact_id, contactId))
      .execute();

    return result;
  };

  private readonly buildChatContactResponse = (
    contactData: NonNullable<
      Awaited<ReturnType<typeof this.findChatContactById>>
    >,
    labels: Awaited<ReturnType<typeof this.findLabelsByContactId>>
  ): ViewChatContactResponse => {
    const labelTemplates = this.formatLabels(labels);
    const formattedUser = this.formatUser(contactData.user);

    return {
      contact_id: contactData.contact_id,
      name: contactData.name,
      last_name: contactData.last_name ?? null,
      email_partial: contactData.email_partial ?? null,
      phone_ddi: contactData.phone_ddi ?? null,
      phone_partial: contactData.phone_partial ?? null,
      nickname: contactData.nickname ?? null,
      birthday: contactData.birthday ?? null,
      notes: contactData.notes ?? null,
      document: contactData.document ?? null,
      document_partial: contactData.document_partial ?? null,
      photo: contactData.photo ?? null,
      is_valided: contactData.is_valided ?? null,
      label_templates: labelTemplates,
      contact_document_type: contactData.contact_document_type,
      user: formattedUser,
      ignore: contactData.ignore ?? null,
    };
  };

  private readonly formatLabels = (
    labels: Awaited<ReturnType<typeof this.findLabelsByContactId>>
  ): Array<{ label_template_id: string; label: string; color: string }> => {
    return labels.map((label) => ({
      label_template_id: label.label_template_id,
      label: label.label,
      color: label.color,
    }));
  };

  private readonly formatUser = (
    userData: {
      user_id: string | null;
      name: string | null;
      photo: string | null;
    } | null
  ): ViewChatContactResponse['user'] => {
    if (!userData?.user_id) {
      return null;
    }

    return {
      user_id: userData.user_id,
      name: userData.name,
      photo: userData.photo,
    };
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

    const [contacts, labelsByContactId] = await Promise.all([
      this.findChatContactsByIds(contactIds, accountId),
      this.findLabelsByContactIds(contactIds),
    ]);

    return this.buildChatContactsResponse(contacts, labelsByContactId);
  };

  private readonly findChatContactsByIds = async (
    contactIds: string[],
    accountId: string
  ) => {
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

    return result;
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
      .where(inArray(contactLabelTemplate.contact_id, contactIds))
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

  private readonly buildChatContactsResponse = (
    contacts: Awaited<ReturnType<typeof this.findChatContactsByIds>>,
    labelsByContactId: Awaited<ReturnType<typeof this.findLabelsByContactIds>>
  ): ViewChatContactResponse[] => {
    return contacts.map((contactData) => {
      const labelTemplates =
        labelsByContactId.get(contactData.contact_id) ?? [];
      const formattedUser = this.formatUser(contactData.user);

      return {
        contact_id: contactData.contact_id,
        name: contactData.name,
        last_name: contactData.last_name ?? null,
        email_partial: contactData.email_partial ?? null,
        phone_ddi: contactData.phone_ddi ?? null,
        phone_partial: contactData.phone_partial ?? null,
        nickname: contactData.nickname ?? null,
        birthday: contactData.birthday ?? null,
        notes: contactData.notes ?? null,
        document: contactData.document ?? null,
        document_partial: contactData.document_partial ?? null,
        photo: contactData.photo ?? null,
        is_valided: contactData.is_valided ?? null,
        label_templates: labelTemplates,
        contact_document_type: contactData.contact_document_type,
        user: formattedUser,
        ignore: contactData.ignore ?? null,
      };
    });
  };
}
