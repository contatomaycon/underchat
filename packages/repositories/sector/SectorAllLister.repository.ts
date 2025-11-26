import * as schema from '@core/models';
import { sector, sectorStatus, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TransferSector } from '@core/schema/chat/listTransferOptions/response.schema';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

@injectable()
export class SectorAllListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAllSectors = async (
    accountId: string,
    isAdministrator: boolean
  ): Promise<TransferSector[]> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const result = await this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
        color: sector.color,
        sector_status: {
          id: sectorStatus.sector_status_id,
        },
      })
      .from(sector)
      .leftJoin(
        sectorStatus,
        eq(sector.sector_status_id, sectorStatus.sector_status_id)
      )
      .where(
        and(
          accountCondition,
          isNull(sector.deleted_at),
          eq(sector.sector_status_id, ESectorStatus.active)
        )
      )
      .orderBy(asc(sector.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as TransferSector[];
  };
}
