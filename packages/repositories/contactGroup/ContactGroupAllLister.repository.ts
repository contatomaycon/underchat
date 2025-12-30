import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import { ListContactGroupAllResponse } from '@core/schema/contactGroup/listContactGroupAll/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactGroupAllListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listContactGroupAll = async (
    accountId: string
  ): Promise<ListContactGroupAllResponse[] | null> => {
    const result = await this.dbRo
      .select({
        contact_group_id: contactGroup.contact_group_id,
        name: contactGroup.name,
      })
      .from(contactGroup)
      .where(
        and(
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    return result as ListContactGroupAllResponse[];
  };
}
