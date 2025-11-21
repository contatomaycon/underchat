import * as schema from '@core/models';
import { sectorStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class SectorStatusViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsSectorStatusById = async (sectorStatusId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(sectorStatus)
      .where(eq(sectorStatus.sector_status_id, sectorStatusId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
