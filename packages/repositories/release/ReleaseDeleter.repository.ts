import * as schema from '@core/models';
import { release, releaseAccess, releaseView } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@injectable()
export class ReleaseDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteById = async (
    releaseId: string,
    userId: string
  ): Promise<true | 'not_found' | 'forbidden'> => {
    return this.dbRw.transaction(async (tx) => {
      const validation = await this.validateCanDelete(tx, releaseId, userId);
      if (validation !== 'ok') {
        return validation;
      }

      await this.deleteReleaseViews(tx, releaseId);
      await this.deleteReleaseAccesses(tx, releaseId);
      const deleted = await this.deleteReleaseRecord(tx, releaseId);

      return deleted ? true : 'not_found';
    });
  };

  private readonly validateCanDelete = async (
    tx: Tx,
    releaseId: string,
    userId: string
  ): Promise<'not_found' | 'forbidden' | 'ok'> => {
    const [row] = await tx
      .select({ created_by_user_id: release.created_by_user_id })
      .from(release)
      .where(eq(release.release_id, releaseId))
      .limit(1)
      .execute();

    if (!row) {
      return 'not_found';
    }

    if (row.created_by_user_id === null || row.created_by_user_id !== userId) {
      return 'forbidden';
    }

    return 'ok';
  };

  private readonly deleteReleaseViews = async (
    tx: Tx,
    releaseId: string
  ): Promise<void> => {
    await tx
      .delete(releaseView)
      .where(eq(releaseView.release_id, releaseId))
      .execute();
  };

  private readonly deleteReleaseAccesses = async (
    tx: Tx,
    releaseId: string
  ): Promise<void> => {
    await tx
      .delete(releaseAccess)
      .where(eq(releaseAccess.release_id, releaseId))
      .execute();
  };

  private readonly deleteReleaseRecord = async (
    tx: Tx,
    releaseId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(release)
      .where(eq(release.release_id, releaseId))
      .execute();

    return result.rowCount === 1;
  };
}
