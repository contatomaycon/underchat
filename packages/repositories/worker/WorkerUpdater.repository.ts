import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { currentTime } from '@core/common/functions/currentTime';

export interface WorkerLifecycleUpdateGuard {
  lifecycle_operation_id?: string | null;
  server_id?: string;
  worker_type_id?: string;
}

@injectable()
export class WorkerUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateWorker
  ): Partial<typeof worker.$inferInsert> & Record<string, unknown> {
    const inputUpdate: Partial<typeof worker.$inferInsert> &
      Record<string, unknown> = {};

    if (input.worker_status_id) {
      inputUpdate.worker_status_id = input.worker_status_id;
    }

    if (input.worker_type_id) {
      inputUpdate.worker_type_id = input.worker_type_id;
    }

    if (input.server_id) {
      inputUpdate.server_id = input.server_id;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if ('number' in input) {
      inputUpdate.number = input.number;
    }

    if ('container_id' in input) {
      inputUpdate.container_id = input.container_id;
    }

    if ('lifecycle_operation_id' in input) {
      inputUpdate.lifecycle_operation_id = input.lifecycle_operation_id;
    }

    if ('connection_date' in input) {
      inputUpdate.connection_date = input.connection_date;
    }

    if (input.deleted_at) {
      inputUpdate.deleted_at = input.deleted_at;
    }

    return inputUpdate;
  }

  updateWorkerById = async (
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    updateInput.updated_at = currentTime();

    const result = await this.dbRw
      .update(worker)
      .set(updateInput)
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, input.worker_id)
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  updateWorkerByIdIfLifecycleMatches = async (
    accountId: string,
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    updateInput.updated_at = currentTime();

    const conditions = [
      eq(worker.account_id, accountId),
      eq(worker.worker_id, input.worker_id),
    ];

    if ('lifecycle_operation_id' in guard) {
      conditions.push(
        guard.lifecycle_operation_id
          ? eq(worker.lifecycle_operation_id, guard.lifecycle_operation_id)
          : isNull(worker.lifecycle_operation_id)
      );
    }

    if (guard.server_id) {
      conditions.push(eq(worker.server_id, guard.server_id));
    }

    if (guard.worker_type_id) {
      conditions.push(eq(worker.worker_type_id, guard.worker_type_id));
    }

    const result = await this.dbRw
      .update(worker)
      .set(updateInput)
      .where(and(...conditions))
      .execute();

    return result.rowCount === 1;
  };
}
