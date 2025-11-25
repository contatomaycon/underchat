import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
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
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateWorkerConfigTx(tx, workerId, input);
        return;
      }

      await this.createWorkerConfigTx(tx, workerId, input);
    });
  };

  private async ensureSingleConfigPerWorker(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string
  ): Promise<void> {
    const existingConfigs = await tx
      .select({ worker_config_id: workerConfig.worker_config_id })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .execute();

    if (existingConfigs.length <= 1) {
      return;
    }

    const configsToDelete = existingConfigs.slice(1);
    for (const config of configsToDelete) {
      await tx
        .delete(workerConfig)
        .where(eq(workerConfig.worker_config_id, config.worker_config_id))
        .execute();
    }
  }

  private async findExistingConfigTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string
  ): Promise<boolean> {
    const result = await tx
      .select({ worker_config_id: workerConfig.worker_config_id })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result.length > 0;
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

  private async updateWorkerConfigTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> {
    const updateData = this.buildUpdateData(input);

    if (Object.keys(updateData).length <= 1) {
      return;
    }

    await tx
      .update(workerConfig)
      .set(updateData)
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createWorkerConfigTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> {
    await tx
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
  }
}
