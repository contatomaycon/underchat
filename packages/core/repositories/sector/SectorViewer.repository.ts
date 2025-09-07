import * as schema from '@core/models';
import { sector, sectorStatus, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewSectorResponse } from '@core/schema/sector/viewSector/response.schema';

@injectable()
export class SectorViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewSectorResponse | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const result = await this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
        color: sector.color,
        account: {
          id: account.account_id,
          name: account.name,
        },
        sector_status: {
          id: sectorStatus.sector_status_id,
          name: sectorStatus.name,
        },
        created_at: sector.created_at,
      })
      .from(sector)
      .leftJoin(account, eq(sector.account_id, account.account_id))
      .leftJoin(
        sectorStatus,
        eq(sector.sector_status_id, sectorStatus.sector_status_id)
      )
      .where(
        and(
          accountCondition,
          eq(sector.sector_id, sectorId),
          isNull(sector.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    const item = result[0] as ViewSectorResponse;

    return {
      sector_id: item.sector_id,
      name: item.name,
      color: item.color,
      account: isAdministrator ? item.account : undefined,
      sector_status: isAdministrator ? item.sector_status : undefined,
      created_at: item.created_at,
    };
  };
}
