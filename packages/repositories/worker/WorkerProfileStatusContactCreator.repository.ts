import * as schema from '@core/models';
import { workerProfileStatusContact } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class WorkerProfileStatusContactCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorkerProfileStatusContact = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerProfileStatusId: string,
    contactId: string
  ): Promise<string | null> => {
    const workerProfileStatusContactId = uuidv7();

    const result = await tx
      .insert(workerProfileStatusContact)
      .values({
        worker_profile_status_contact_id: workerProfileStatusContactId,
        worker_profile_status_id: workerProfileStatusId,
        contact_id: contactId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return workerProfileStatusContactId;
  };
}
