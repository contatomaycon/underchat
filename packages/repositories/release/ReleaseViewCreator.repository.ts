import * as schema from '@core/models';
import { releaseView } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ReleaseViewCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createReleaseView = async (
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const releaseViewId = uuidv7();

    const result = await this.dbRw
      .insert(releaseView)
      .values({
        release_view_id: releaseViewId,
        release_id: releaseId,
        user_id: userId,
      })
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  createReleaseViewInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const releaseViewId = uuidv7();

    const result = await tx
      .insert(releaseView)
      .values({
        release_view_id: releaseViewId,
        release_id: releaseId,
        user_id: userId,
      })
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
