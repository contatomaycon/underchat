import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerPhoneStatusConnectionDateUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly connectionDate = (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ) => {
    if (input.status === EWorkerStatus.disponible || !input.number) {
      return null;
    }

    if (input.connection_date) {
      return input.connection_date;
    }

    return currentTime();
  };

  updateWorkerPhoneStatusConnectionDate = async (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ): Promise<boolean> => {
    const phoneNumber =
      input.status === EWorkerStatus.disponible ? null : input.number;
    const connectionDate = this.connectionDate(input);

    const result = await this.db
      .update(worker)
      .set({
        worker_status_id: input.status,
        number: phoneNumber,
        connection_date: connectionDate,
      })
      .where(and(eq(worker.worker_id, input.worker_id)))
      .execute();

    return result.rowCount === 1;
  };
}
