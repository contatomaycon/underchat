import * as schema from '@core/models';
import { contact, contactGroupAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';

@injectable()
export class ContactListerByGroupRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listContactsByGroupIds = async (
    accountId: string,
    contactGroupIds: string[]
  ): Promise<string[]> => {
    if (contactGroupIds.length === 0) {
      return [];
    }

    const result = await this.db
      .select({
        contact_id: contact.contact_id,
      })
      .from(contact)
      .innerJoin(
        contactGroupAssignment,
        eq(contact.contact_id, contactGroupAssignment.contact_id)
      )
      .where(
        and(
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at),
          inArray(
            contactGroupAssignment.contact_group_id,
            contactGroupIds
          )
        )
      )
      .execute();

    const uniqueContactIds = Array.from(
      new Set(result.map((item) => item.contact_id))
    );

    return uniqueContactIds;
  };
}
