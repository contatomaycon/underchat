import * as schema from '@core/models';
import { sectorUser, sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UserSectorsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUserSectors = async (
    accountId: string,
    userId: string
  ): Promise<string[]> => {
    const result = await this.dbRo
      .select({
        sector_id: sector.sector_id,
      })
      .from(sectorUser)
      .innerJoin(sector, eq(sectorUser.sector_id, sector.sector_id))
      .where(
        and(
          eq(sectorUser.user_id, userId),
          eq(sector.account_id, accountId),
          isNull(sectorUser.deleted_at),
          isNull(sector.deleted_at)
        )
      )
      .groupBy(sector.sector_id)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.sector_id);
  };
}
