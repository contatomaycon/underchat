import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class WorkerCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createWorker = async (input: ICreateWorker): Promise<boolean> => {
    const result = await this.dbRw
      .insert(worker)
      .values({
        worker_id: input.worker_id,
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        server_id: input.server_id,
        account_id: input.account_id,
        name: input.name,
        session_storage: input.session_storage,
        lifecycle_operation_id: input.lifecycle_operation_id,
        recreate_available_at: input.recreate_available_at ?? null,
      })
      .execute();

    return result.rowCount === 1;
  };
}
