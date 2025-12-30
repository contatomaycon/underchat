import * as schema from '@core/models';
import {
  sectorRole,
  permissionRole,
  permissionAssignment,
  sector,
} from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserSectorsListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listUserSectors = async (
    accountId: string,
    userId: string
  ): Promise<string[]> => {
    const result = await this.db
      .select({
        sector_id: sector.sector_id,
      })
      .from(permissionAssignment)
      .innerJoin(
        permissionRole,
        eq(
          permissionAssignment.permission_role_id,
          permissionRole.permission_role_id
        )
      )
      .innerJoin(
        sectorRole,
        eq(sectorRole.permission_role_id, permissionRole.permission_role_id)
      )
      .innerJoin(sector, eq(sectorRole.sector_id, sector.sector_id))
      .where(
        and(
          eq(permissionAssignment.user_id, userId),
          eq(permissionRole.account_id, accountId),
          eq(sector.account_id, accountId),
          isNull(sector.deleted_at),
          isNull(sectorRole.deleted_at)
        )
      )
      .groupBy(sector.sector_id)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.sector_id);
  };
}
