import * as schema from '@core/models';
import {
  contact,
  labelTemplate,
  account,
  contactDocumentType,
  contactLabelTemplate,
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
    const [contactData, labels] = await Promise.all([
      this.findContactById(contactId, accountId),
      this.findLabelsByContactId(contactId),
    ]);

    if (!contactData) {
      return null;
    }

    return this.buildViewContactResponse(contactData, labels);
  };

  private readonly findContactById = async (
    contactId: string,
    accountId?: string
  ) => {
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
        ignore: contact.ignore,
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

  private readonly buildViewContactResponse = (
    contactData: NonNullable<Awaited<ReturnType<typeof this.findContactById>>>,
    labels: Awaited<ReturnType<typeof this.findLabelsByContactId>>
  ): ViewContactResponse & { phone: string } => {
    if (!contactData.account) {
      throw new Error('Account is required');
    }

    const labelTemplates = this.formatLabels(labels);
    const formattedUser = this.formatUser(contactData.user);

    return {
      contact_id: contactData.contact_id,
      account: contactData.account,
      contact_document_type: contactData.contact_document_type,
      label_templates: labelTemplates,
      name: contactData.name,
      last_name: contactData.last_name ?? null,
      email_partial: contactData.email_partial ?? null,
      phone_ddi: contactData.phone_ddi ?? null,
      phone_partial: contactData.phone_partial ?? null,
      phone: contactData.phone ?? '',
      created_at: contactData.created_at ?? null,
      nickname: contactData.nickname ?? null,
      birthday: contactData.birthday ?? null,
      notes: contactData.notes ?? null,
      document: contactData.document ?? null,
      document_partial: contactData.document_partial ?? null,
      is_valided: contactData.is_valided ?? null,
      photo: contactData.photo ?? null,
      user: formattedUser,
      ignore: contactData.ignore ?? null,
    };
  };

  viewContactByPhone = async (
    accountId: string,
    phonesC: string[],
    phoneDdi: string
  ): Promise<ViewContactResponse | null> => {
    const contactData = await this.findContactByPhone(
      accountId,
      phonesC,
      phoneDdi
    );

    if (!contactData) {
      return null;
    }

    const labels = await this.findLabelsByContactId(contactData.contact_id);

    return this.buildViewContactResponseByPhone(contactData, labels);
  };

  private readonly findContactByPhone = async (
    accountId: string,
    phonesC: string[],
    phoneDdi: string
  ) => {
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
        ignore: contact.ignore,
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

    return result[0] ?? null;
  };

  private readonly buildViewContactResponseByPhone = (
    contactData: NonNullable<
      Awaited<ReturnType<typeof this.findContactByPhone>>
    >,
    labels: Awaited<ReturnType<typeof this.findLabelsByContactId>>
  ): ViewContactResponse => {
    if (!contactData.account) {
      throw new Error('Account is required');
    }

    const labelTemplates = this.formatLabels(labels);
    const formattedUser = this.formatUser(contactData.user);

    return {
      contact_id: contactData.contact_id,
      account: contactData.account,
      contact_document_type: contactData.contact_document_type,
      label_templates: labelTemplates,
      name: contactData.name,
      last_name: contactData.last_name ?? null,
      email_partial: contactData.email_partial ?? null,
      phone_ddi: contactData.phone_ddi ?? null,
      phone_partial: contactData.phone_partial ?? null,
      created_at: contactData.created_at ?? null,
      nickname: contactData.nickname ?? null,
      birthday: contactData.birthday ?? null,
      notes: contactData.notes ?? null,
      document: contactData.document ?? null,
      document_partial: contactData.document_partial ?? null,
      is_valided: contactData.is_valided ?? null,
      photo: contactData.photo ?? null,
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
  ): ViewContactResponse['user'] => {
    if (!userData?.user_id) {
      return null;
    }

    return {
      user_id: userData.user_id,
      name: userData.name,
      photo: userData.photo,
    };
  };
}
