import * as schema from '@core/models';
import { sectorRole } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class SectorRoleDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteSectorRoleById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    sectorId: string
  ): Promise<boolean> => {
    await tx
      .delete(sectorRole)
      .where(eq(sectorRole.sector_id, sectorId))
      .execute();

    return true;
  };
}
