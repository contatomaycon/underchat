import * as schema from '@core/models';
import { server, serverWeb, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, lt, count, asc, notInArray } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IListWorkerServer } from '@core/common/interfaces/IListWorkerServer';

@injectable()
export class WorkerServerListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listWorkerServers = async (): Promise<IListWorkerServer[]> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        name: server.name,
      })
      .from(server)
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
      .leftJoin(
        worker,
        and(
          eq(worker.server_id, server.server_id),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
          ])
        )
      )
      .where(
        and(
          isNull(server.deleted_at),
          eq(server.server_status_id, EServerStatus.online)
        )
      )
      .groupBy(server.server_id, server.quantity_workers, server.name)
      .having(lt(count(worker.worker_id), server.quantity_workers))
      .orderBy(asc(count(worker.worker_id)))
      .execute();

    return result as IListWorkerServer[];
  };
}
