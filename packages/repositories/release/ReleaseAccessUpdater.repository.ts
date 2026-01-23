import * as schema from '@core/models';
import { releaseAccess } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ReleaseAccessUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  markAsViewed = async (
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(releaseAccess)
      .set({
        viewed: true,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(releaseAccess.release_id, releaseId),
          eq(releaseAccess.user_id, userId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  createReleaseAccess = async (
    releaseId: string,
    userId: string
  ): Promise<string | null> => {
    const releaseAccessId = uuidv7();

    const result = await this.dbRw
      .insert(releaseAccess)
      .values({
        release_access_id: releaseAccessId,
        release_id: releaseId,
        user_id: userId,
        viewed: true,
      })
      .execute();

    if (!result) {
      return null;
    }

    return releaseAccessId;
  };

  markAsViewedInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const result = await tx
      .update(releaseAccess)
      .set({
        viewed: true,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(releaseAccess.release_id, releaseId),
          eq(releaseAccess.user_id, userId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  createReleaseAccessInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    releaseId: string,
    userId: string
  ): Promise<string | null> => {
    const releaseAccessId = uuidv7();

    const result = await tx
      .insert(releaseAccess)
      .values({
        release_access_id: releaseAccessId,
        release_id: releaseId,
        user_id: userId,
        viewed: true,
      })
      .execute();

    if (!result) {
      return null;
    }

    return releaseAccessId;
  };
}
