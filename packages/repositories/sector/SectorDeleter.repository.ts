import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class SectorDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteSectorById = async (
    sectorId: string,
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(sector)
      .set({
        deleted_at: date,
      })
      .where(
        and(eq(sector.account_id, accountId), eq(sector.sector_id, sectorId))
      )
      .execute();

    return result.rowCount === 1;
  };
}
