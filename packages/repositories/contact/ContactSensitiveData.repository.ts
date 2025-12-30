import * as schema from '@core/models';
import { contact } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactSensitiveDataRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getContactSensitiveDataById = async (
    contactId: string
  ): Promise<{ phone: string | null; email: string | null } | null> => {
    const result = await this.dbRo
      .select({
        phone: contact.phone,
        email: contact.email,
      })
      .from(contact)
      .where(and(eq(contact.contact_id, contactId), isNull(contact.deleted_at)))
      .execute();

    if (!result.length) {
      return null;
    }

    return {
      phone: result[0].phone ?? null,
      email: result[0].email ?? null,
    };
  };
}
