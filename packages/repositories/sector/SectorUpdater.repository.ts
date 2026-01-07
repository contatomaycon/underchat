import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class SectorUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateSectorById = async (
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const updateData: Partial<{
      name: string;
      color: string;
      sector_status_id: string;
      updated_at: string;
    }> = {
      updated_at: date,
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }

    if (input.color !== undefined) {
      updateData.color = input.color;
    }

    if (input.sector_status_id !== undefined) {
      updateData.sector_status_id = input.sector_status_id;
    }

    const result = await this.dbRw
      .update(sector)
      .set(updateData)
      .where(
        and(eq(sector.account_id, accountId), eq(sector.sector_id, sectorId))
      )
      .execute();

    return result.rowCount === 1;
  };
}
