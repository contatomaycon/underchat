import * as schema from '@core/models';
import { workerProfileStatusContact } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class WorkerProfileStatusContactDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteWorkerProfileStatusContactByStatusId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerProfileStatusId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(workerProfileStatusContact)
      .where(
        eq(
          workerProfileStatusContact.worker_profile_status_id,
          workerProfileStatusId
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
