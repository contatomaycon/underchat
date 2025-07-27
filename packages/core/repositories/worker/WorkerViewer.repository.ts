import * as schema from '@core/models';
import {
  worker,
  workerStatus,
  workerType,
  server,
  account,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';

@injectable()
export class WorkerViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorker = async (
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(account.account_id, accountId);

    const result = await this.db
      .select({
        id: worker.worker_id,
        name: worker.name,
        number: worker.number,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        type: {
          id: workerType.worker_type_id,
          name: workerType.type,
        },
        server: {
          id: server.server_id,
          name: server.name,
        },
        account: {
          id: account.account_id,
          name: account.name,
        },
        created_at: worker.created_at,
        updated_at: worker.updated_at,
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .innerJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .where(
        and(
          accountCondition,
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    const item = result[0] as ViewWorkerResponse;

    return {
      id: item.id,
      name: item.name,
      number: item.number,
      status: item.status,
      type: item.type,
      server: isAdministrator ? item.server : undefined,
      account: isAdministrator ? item.account : undefined,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  };
}
