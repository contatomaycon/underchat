import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TransferSectorResponse } from '@core/schema/chat/listTransferSectors/response.schema';

@injectable()
export class SectorTransferListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listSectorsForTransfer = async (
    accountId: string
  ): Promise<TransferSectorResponse[]> => {
    const result = await this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
        color: sector.color,
      })
      .from(sector)
      .where(and(eq(sector.account_id, accountId), isNull(sector.deleted_at)))
      .orderBy(asc(sector.name))
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((sector) => ({
      id: sector.sector_id,
      name: sector.name,
      color: sector.color || null,
    }));
  };
}
