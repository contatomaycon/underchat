import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class ContactListerByAccountRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listContactsByAccountId = async (accountId: string): Promise<string[]> => {
    const result = await this.db
      .select({
        contact_id: contact.contact_id,
      })
      .from(contact)
      .where(and(eq(contact.account_id, accountId), isNull(contact.deleted_at)))
      .execute();

    return result.map((item) => item.contact_id);
  };
}
