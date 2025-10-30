import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { injectable } from 'tsyringe';
import * as schema from '@core/models';
import { sectorRole } from '@core/models';
import { v4 as uuidv4 } from 'uuid';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class SectorRoleCreatorRepository {
  constructor() {}

  createSectorRole = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    sectorId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    const sectorRoleId = uuidv4();

    const result = await tx
      .insert(sectorRole)
      .values({
        sector_role_id: sectorRoleId,
        sector_id: sectorId,
        permission_role_id: permissionRoleId,
      })
      .execute();

    if (!result) {
      return false;
    }

    return true;
  };
}
