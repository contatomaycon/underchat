import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';

@injectable()
export class WorkerUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateWorker
  ): Partial<typeof worker.$inferInsert> {
    const inputUpdate: Partial<typeof worker.$inferInsert> = {};

    if (input.worker_status_id) {
      inputUpdate.worker_status_id = input.worker_status_id;
    }

    if (input.worker_type_id) {
      inputUpdate.worker_type_id = input.worker_type_id;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.number) {
      inputUpdate.number = input.number;
    }

    if (input.container_id) {
      inputUpdate.container_id = input.container_id;
    }

    if (input.connection_date) {
      inputUpdate.connection_date = input.connection_date;
    }

    return inputUpdate;
  }

  updateWorkerById = async (
    isAdministrator: boolean,
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(worker.account_id, accountId);

    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    const result = await this.db
      .update(worker)
      .set(updateInput)
      .where(and(eq(worker.worker_id, input.worker_id), accountCondition))
      .execute();

    return result.rowCount === 1;
  };
}
