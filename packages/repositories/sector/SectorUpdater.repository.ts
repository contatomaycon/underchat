import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';

@injectable()
export class SectorUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateSectorById = async (
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string
  ): Promise<string | null> => {
    const result = await this.db
      .update(sector)
      .set({
        sector_status_id: input.sector_status_id,
        name: input.name,
        color: input.color,
      })
      .where(
        and(eq(sector.sector_id, sectorId), eq(sector.account_id, accountId))
      )
      .execute();

    if (result.rowCount === 0) {
      return null;
    }

    return accountId;
  };
}
