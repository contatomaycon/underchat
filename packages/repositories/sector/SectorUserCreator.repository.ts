import * as schema from '@core/models';
import { sectorUser } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class SectorUserCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createSectorUserInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    sectorId: string
  ): Promise<string | null> => {
    const sectorUserId = uuidv7();
    const date = currentTime();

    const result = await tx
      .insert(sectorUser)
      .values({
        sector_user_id: sectorUserId,
        user_id: userId,
        sector_id: sectorId,
        created_at: date,
        updated_at: date,
      })
      .execute();

    if (!result) {
      return null;
    }

    return sectorUserId;
  };
}
