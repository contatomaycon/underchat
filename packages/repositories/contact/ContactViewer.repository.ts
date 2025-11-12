import * as schema from '@core/models';
import { contact, labelTemplate, account } from '@core/models';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewContactById = async (
    contactId: string
  ): Promise<ViewContactResponse | null> => {
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
        email: contact.email,
        email_partial: contact.email_partial,
        phone_ddi: contact.phone_ddi,
        phone: contact.phone,
        phone_partial: contact.phone_partial,
        nickname: contact.nickname,
        birthday: contact.birthday,
        notes: contact.notes,
        created_at: contact.created_at,
      })
      .from(contact)
      .leftJoin(account, eq(contact.account_id, account.account_id))
      .leftJoin(
        labelTemplate,
        eq(labelTemplate.label_template_id, contact.label_template_id)
      )
      .where(and(eq(contact.contact_id, contactId), isNull(contact.deleted_at)))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as ViewContactResponse;
  };
}
