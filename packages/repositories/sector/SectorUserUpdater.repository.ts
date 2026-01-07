import * as schema from '@core/models';
import { sectorUser } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { PgTransaction } from 'drizzle-orm/pg-core';
import {
  and,
  eq,
  inArray,
  isNull,
  ExtractTablesWithRelations,
} from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class SectorUserUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listUserSectorsInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string
  ): Promise<string[]> => {
    const result = await tx
      .select({
        sector_id: sectorUser.sector_id,
      })
      .from(sectorUser)
      .where(and(eq(sectorUser.user_id, userId), isNull(sectorUser.deleted_at)))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.sector_id);
  };

  markSectorUsersAsDeletedInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    sectorIds: string[]
  ): Promise<boolean> => {
    if (!sectorIds.length) {
      return true;
    }

    const date = currentTime();

    await tx
      .update(sectorUser)
      .set({
        deleted_at: date,
        updated_at: date,
      })
      .where(
        and(
          eq(sectorUser.user_id, userId),
          inArray(sectorUser.sector_id, sectorIds),
          isNull(sectorUser.deleted_at)
        )
      )
      .execute();

    return true;
  };

  restoreSectorUsersInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    sectorIds: string[]
  ): Promise<boolean> => {
    if (!sectorIds.length) {
      return true;
    }

    const date = currentTime();

    await tx
      .update(sectorUser)
      .set({
        deleted_at: null,
        updated_at: date,
      })
      .where(
        and(
          eq(sectorUser.user_id, userId),
          inArray(sectorUser.sector_id, sectorIds)
        )
      )
      .execute();

    return true;
  };
}
