import * as schema from '@core/models';
import { sectorRole, permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ListSectorRoleAccountSectorResponse } from '@core/schema/sector/listSectorRoleAccountSector/response.schema';

@injectable()
export class SectorRoleListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listSectorRoleAccountSectorById = async (
    accountId: string,
    sectorId: string
  ): Promise<ListSectorRoleAccountSectorResponse[]> => {
    const result = await this.db
      .select({
        id: sectorRole.permission_role_id,
        name: permissionRole.name,
      })
      .from(sectorRole)
      .innerJoin(
        permissionRole,
        eq(sectorRole.permission_role_id, permissionRole.permission_role_id)
      )
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(sectorRole.sector_id, sectorId)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as ListSectorRoleAccountSectorResponse[];
  };
}
