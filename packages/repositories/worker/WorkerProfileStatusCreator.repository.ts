import * as schema from '@core/models';
import { workerProfileStatus } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ICreateWorkerProfileStatus } from '@core/common/interfaces/ICreateWorkerProfileStatus';

@injectable()
export class WorkerProfileStatusCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorkerProfileStatus = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateWorkerProfileStatus
  ): Promise<string> => {
    const worker_profile_status_id = uuidv7();

    await tx
      .insert(workerProfileStatus)
      .values({
        worker_profile_status_id,
        worker_id: input.worker_id,
        worker_profile_status_type_id: input.worker_profile_status_type_id,
        value: input.value,
        is_permanent: input.is_permanent,
        mimetype: input.mimetype ?? null,
        duration: input.duration ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
      })
      .execute();

    return worker_profile_status_id;
  };
}
