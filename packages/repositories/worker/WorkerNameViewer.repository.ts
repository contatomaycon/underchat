import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class WorkerNameViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findWorkerNameById = async (workerId: string): Promise<string | null> => {
    const result = await this.db
      .select({
        name: worker.name,
      })
      .from(worker)
      .where(and(eq(worker.worker_id, workerId), isNull(worker.deleted_at)))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0].name;
  };
}
