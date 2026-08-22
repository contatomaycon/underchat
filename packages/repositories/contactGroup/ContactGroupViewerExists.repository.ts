import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class ContactGroupViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsContactGroupById = async (
    contactGroupId: string,
    accountId?: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contactGroup)
      .where(
        and(
          eq(contactGroup.contact_group_id, contactGroupId),
          accountId ? eq(contactGroup.account_id, accountId) : undefined,
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
