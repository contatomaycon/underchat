import * as schema from '@core/models';
import { sectorRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class SectorRoleViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsSectorRoleById = async (sectorId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(sectorRole)
      .where(eq(sectorRole.sector_id, sectorId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
