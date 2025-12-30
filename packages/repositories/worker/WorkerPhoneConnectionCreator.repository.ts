import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import * as schema from '@core/models';
import { workerPhoneConnection } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class WorkerPhoneConnectionCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorkerPhoneConnection = async (
    input: ICreateWorkerPhoneConnection
  ): Promise<boolean> => {
    const result = await this.db
      .insert(workerPhoneConnection)
      .values({
        worker_phone_connection_id: uuidv7(),
        worker_id: input.worker_id,
        number: input.number,
        attempt: input.attempt,
        date_attempt: input.attempt_date,
      })
      .execute();

    return result.rowCount === 1;
  };
}
