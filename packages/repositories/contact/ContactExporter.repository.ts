import * as schema from '@core/models';
import {
  contact,
  contactDocumentType,
  contactLabelTemplate,
  labelTemplate,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ExportContactResponse } from '@core/schema/contact/exportContact/response.schema';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

@injectable()
export class ContactExporterRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

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

  exportContacts = async (
    accountId: string,
    contactIds: string[] | null = null
  ): Promise<ExportContactResponse[]> => {
    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ].filter(isDefinedFilter);

    if (contactIds && contactIds.length > 0) {
      whereConditions.push(inArray(contact.contact_id, contactIds));
    }

    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
        name: contact.name,
        last_name: contact.last_name,
        email: contact.email,
        phone_ddi: contact.phone_ddi,
        phone: contact.phone,
        nickname: contact.nickname,
        birthday: sql<
          string | null
        >`CASE WHEN ${contact.birthday} IS NULL THEN NULL ELSE to_char(${contact.birthday}, 'YYYY-MM-DD') END`,
        notes: contact.notes,
        contact_document_type_name: contactDocumentType.name,
        document: contact.document,
      })
      .from(contact)
      .leftJoin(
        contactDocumentType,
        eq(
          contact.contact_document_type_id,
          contactDocumentType.contact_document_type_id
        )
      )
      .where(and(...whereConditions))
      .orderBy(contact.created_at)
      .execute();

    const resultContactIds = result.map((r) => r.contact_id);
    const labelsByContactId =
      await this.findLabelsByContactIds(resultContactIds);

    return result.map((item) => ({
      ...item,
      labels: labelsByContactId.get(item.contact_id) ?? [],
    })) as ExportContactResponse[];
  };
}
