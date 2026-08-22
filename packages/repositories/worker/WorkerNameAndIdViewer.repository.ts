import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';

@injectable()
export class WorkerNameAndIdViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerNameAndId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.viewWorkerNameAndIdFrom(this.dbRo, accountId, workerId);
  };

  viewWorkerNameAndIdConsistent = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.viewWorkerNameAndIdFrom(this.dbRw, accountId, workerId);
  };

  private readonly viewWorkerNameAndIdFrom = async (
    db: NodePgDatabase<typeof schema>,
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    const result = await db
      .select({
        id: worker.worker_id,
        name: worker.name,
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IViewWorkerNameAndId;
  };
}
