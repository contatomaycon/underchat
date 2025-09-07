import { ESectorStatus } from '@core/common/enums/ESectorStatus';
import * as schema from '@core/models';
import { sector } from '@core/models';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class SectorCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createSector = async (
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> => {
    const sectorId = uuidv4();

    const result = await this.db
      .insert(sector)
      .values({
        sector_id: sectorId,
        sector_status_id: ESectorStatus.active,
        account_id: accountId,
        name: input.name,
        color: input.color,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return { sector_id: result[0].sector_id };
  };
}
