import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class SectorViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const result = await this.db
      .select({
        total: count(),
      })
      .from(sector)
      .where(
        and(
          accountCondition,
          eq(sector.sector_id, sectorId),
          isNull(sector.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
