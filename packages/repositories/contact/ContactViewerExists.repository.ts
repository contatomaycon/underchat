import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class ContactViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsContactById = async (contactId: string): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contact)
      .where(and(eq(contact.contact_id, contactId), isNull(contact.deleted_at)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
