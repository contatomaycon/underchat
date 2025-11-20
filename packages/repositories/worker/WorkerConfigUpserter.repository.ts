import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';

@injectable()
export class WorkerConfigUpserterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertWorkerConfig = async (
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> => {
    const exists = await this.findExistingConfig(workerId);

    if (exists) {
      await this.updateWorkerConfig(workerId, input);
      return;
    }

    await this.createWorkerConfig(workerId, input);
  };

  private async findExistingConfig(workerId: string): Promise<boolean> {
    const result = await this.db
      .select({ total: count() })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .execute();

    return Boolean(result[0]?.total);
  }

  private buildUpdateData(
    input: IUpdateWorkerConfig
  ): Partial<typeof workerConfig.$inferInsert> {
    const updateData: Partial<typeof workerConfig.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };

    if (input.is_automatic_attendance !== undefined) {
      updateData.is_automatic_attendance = input.is_automatic_attendance;
    }

    if (input.show_attendee_name !== undefined) {
      updateData.show_attendee_name = input.show_attendee_name;
    }

    if (input.show_worker_name !== undefined) {
      updateData.show_worker_name = input.show_worker_name;
    }

    if (input.generate_protocol_at_ura !== undefined) {
      updateData.generate_protocol_at_ura = input.generate_protocol_at_ura;
    }

    if (input.generate_protocol_at_start !== undefined) {
      updateData.generate_protocol_at_start = input.generate_protocol_at_start;
    }

    if (input.generate_protocol_at_transfer !== undefined) {
      updateData.generate_protocol_at_transfer =
        input.generate_protocol_at_transfer;
    }

    return updateData;
  }

  private async updateWorkerConfig(
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> {
    const updateData = this.buildUpdateData(input);

    if (Object.keys(updateData).length <= 1) {
      return;
    }

    await this.db
      .update(workerConfig)
      .set(updateData)
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createWorkerConfig(
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> {
    try {
      await this.db
        .insert(workerConfig)
        .values({
          worker_config_id: uuidv7(),
          worker_id: workerId,
          is_automatic_attendance: input.is_automatic_attendance ?? false,
          show_attendee_name: input.show_attendee_name ?? false,
          show_worker_name: input.show_worker_name ?? false,
          generate_protocol_at_ura: input.generate_protocol_at_ura ?? false,
          generate_protocol_at_start: input.generate_protocol_at_start ?? false,
          generate_protocol_at_transfer:
            input.generate_protocol_at_transfer ?? false,
        })
        .execute();
    } catch (error) {
      console.error(error);
      throw new Error('Failed to create worker config');
    }
  }
}
