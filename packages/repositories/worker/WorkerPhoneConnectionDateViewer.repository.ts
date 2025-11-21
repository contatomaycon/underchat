import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerPhoneConnectionDate } from '@core/common/interfaces/IViewWorkerPhoneConnectionDate';

@injectable()
export class WorkerPhoneConnectionDateViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerPhoneConnectionDate = async (
    workerId: string
  ): Promise<IViewWorkerPhoneConnectionDate | null> => {
    const result = await this.db
      .select({
        id: worker.worker_id,
        number: worker.number,
        connection_date: worker.connection_date,
      })
      .from(worker)
      .where(and(eq(worker.worker_id, workerId), isNull(worker.deleted_at)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerPhoneConnectionDate;
  };
}
