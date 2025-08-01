import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import * as schema from '@core/models';
import { workerPhoneConnection } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class WorkerPhoneConnectionCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createWorkerPhoneConnection = async (
    input: ICreateWorkerPhoneConnection
  ): Promise<boolean> => {
    const result = await this.db
      .insert(workerPhoneConnection)
      .values({
        worker_phone_connection_id: uuidv4(),
        worker_id: input.worker_id,
        number: input.number,
        attempt: input.attempt,
      })
      .execute();

    return result.rowCount === 1;
  };
}
