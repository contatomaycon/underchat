import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class SectorByIdExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  sectorByIdExists = async (
    sectorId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(sector)
      .where(
        and(
          eq(sector.sector_id, sectorId),
          isNull(sector.deleted_at),
          eq(sector.account_id, accountId)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
