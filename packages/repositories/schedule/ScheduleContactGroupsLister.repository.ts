import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import { ListScheduleContactGroupsResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ScheduleContactGroupsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listScheduleContactGroups = async (
    accountId: string
  ): Promise<ListScheduleContactGroupsResponse[]> => {
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
      .orderBy(asc(contactGroup.name))
      .execute();

    if (!result.length) {
      return [];
    }

    return result as ListScheduleContactGroupsResponse[];
  };
}
