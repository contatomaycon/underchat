import * as schema from '@core/models';
import { workerPhoneConnection } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, count } from 'drizzle-orm';
import { IViewWorkerPhoneConnection } from '@core/common/interfaces/IViewWorkerPhoneConnection';

@injectable()
export class WorkerPhoneConnectionViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerPhoneConnection = async (
    number: string
  ): Promise<IViewWorkerPhoneConnection | null> => {
    const result = await this.db
      .select({
        worker_phone_connection_id:
          workerPhoneConnection.worker_phone_connection_id,
        worker_id: workerPhoneConnection.worker_id,
        number: workerPhoneConnection.number,
        attempt: workerPhoneConnection.attempt,
        date_attempt: workerPhoneConnection.date_attempt,
      })
      .from(workerPhoneConnection)
      .where(and(eq(workerPhoneConnection.number, number)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerPhoneConnection;
  };

  totalWorkerPhoneConnection = async (number: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(workerPhoneConnection)
      .where(and(eq(workerPhoneConnection.number, number)))
      .execute();

    return result[0]?.total ?? 0;
  };
}
