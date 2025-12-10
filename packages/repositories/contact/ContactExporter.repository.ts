import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ExportContactResponse } from '@core/schema/contact/exportContact/response.schema';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

@injectable()
export class ContactExporterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  exportContacts = async (
    accountId: string
  ): Promise<ExportContactResponse[]> => {
    const whereConditions = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ].filter(isDefinedFilter);

    const result = await this.db
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
      })
      .from(contact)
      .where(and(...whereConditions))
      .orderBy(contact.created_at)
      .execute();

    return result as ExportContactResponse[];
  };
}
