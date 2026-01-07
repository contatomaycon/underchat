import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';
import { randomUUID } from 'crypto';

@injectable()
export class SectorCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createSector = async (
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> => {
    const sectorId = randomUUID();

    const result = await this.dbRw
      .insert(sector)
      .values({
        sector_id: sectorId,
        account_id: accountId,
        sector_status_id: ESectorStatus.active,
        name: input.name,
        color: input.color,
      })
      .returning({
        sector_id: sector.sector_id,
      })
      .execute();

    if (!result?.length) {
      return null;
    }

    return {
      sector_id: result[0].sector_id,
    };
  };
}
