import * as schema from '@core/models';
import { contact, labelTemplate } from '@core/models';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
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
}
