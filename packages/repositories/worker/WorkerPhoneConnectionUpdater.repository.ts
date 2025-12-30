import * as schema from '@core/models';
import { workerPhoneConnection } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateWorkerPhoneConnection } from '@core/common/interfaces/IUpdateWorkerPhoneConnection';

@injectable()
export class WorkerPhoneConnectionUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateWorkerPhoneConnection = async (
    input: IUpdateWorkerPhoneConnection
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(workerPhoneConnection)
      .set({
        worker_id: input.worker_id,
        number: input.number,
        attempt: input.attempt,
        date_attempt: input.attempt_date,
      })
      .where(
        eq(
          workerPhoneConnection.worker_phone_connection_id,
          input.worker_phone_connection_id
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
