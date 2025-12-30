import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';

@injectable()
export class SectorUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: EditSectorParamsBody
  ): Partial<typeof sector.$inferInsert> {
    const inputUpdate: Partial<typeof sector.$inferInsert> = {};

    if (input.sector_status_id) {
      inputUpdate.sector_status_id = input.sector_status_id;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.color) {
      inputUpdate.color = input.color;
    }

    return inputUpdate;
  }

  updateSectorById = async (
    sectorId: string,
    input: EditSectorParamsBody
  ): Promise<string | null> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return null;
    }

    const result = await this.dbRw
      .update(sector)
      .set(updateInput)
      .where(
        and(
          eq(sector.sector_id, sectorId),
          eq(sector.account_id, input.account_id)
        )
      )
      .execute();

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    return input.account_id;
  };
}
