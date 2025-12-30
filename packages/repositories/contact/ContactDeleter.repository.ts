import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ContactDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteContactById = async (contactId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(contact)
      .set({
        deleted_at: date,
      })
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };
}
