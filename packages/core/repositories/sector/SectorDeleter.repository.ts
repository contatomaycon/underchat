import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class SectorDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const date = currentTime();
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const result = await this.db
      .update(sector)
      .set({
        deleted_at: date,
      })
      .where(and(accountCondition, eq(sector.sector_id, sectorId)))
      .execute();

    return result.rowCount === 1;
  };
}
