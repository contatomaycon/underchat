import * as schema from '@core/models';
import { contactGroup, messageTemplate, labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class DashboardTemplatesRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getContactGroupsTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contactGroup)
      .where(
        and(
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getMessageTemplatesTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.account_id, accountId),
          isNull(messageTemplate.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getLabelTemplatesTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };
}
