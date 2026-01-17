import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WorkerUpdatedAtUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateUpdatedAt = async (workerId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(worker)
      .set({
        updated_at: currentTime(),
      })
      .where(eq(worker.worker_id, workerId))
      .execute();

    return result.rowCount === 1;
  };
}
