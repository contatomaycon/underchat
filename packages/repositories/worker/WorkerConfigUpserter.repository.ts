import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
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

    if (input.allow_attendance_only_online !== undefined) {
      updateData.allow_attendance_only_online =
        input.allow_attendance_only_online;
    }

    if (input.auto_save_contacts !== undefined) {
      updateData.auto_save_contacts = input.auto_save_contacts;
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
        allow_attendance_only_online:
          input.allow_attendance_only_online ?? false,
        auto_save_contacts: input.auto_save_contacts ?? false,
      })
      .execute();
  }

  updateTransferProtocolText = async (
    workerId: string,
    text: string | null
  ): Promise<string | null> => {
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateTransferProtocolTextTx(tx, workerId, text);
        return;
      }

      await this.createTransferProtocolTextTx(tx, workerId, text);
    });

    return this.getTransferProtocolText(workerId);
  };

  private async updateTransferProtocolTextTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        generate_protocol_at_transfer: text || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createTransferProtocolTextTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .insert(workerConfig)
      .values({
        worker_config_id: uuidv7(),
        worker_id: workerId,
        is_automatic_attendance: false,
        show_attendee_name: false,
        show_worker_name: false,
        allow_attendance_only_online: false,
        auto_save_contacts: false,
        generate_protocol_at_transfer: text || null,
      })
      .execute();
  }

  private async getTransferProtocolText(
    workerId: string
  ): Promise<string | null> {
    const result = await this.db
      .select({
        generate_protocol_at_transfer:
          workerConfig.generate_protocol_at_transfer,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0]?.generate_protocol_at_transfer || null;
  }

  updateStartProtocolText = async (
    workerId: string,
    text: string | null
  ): Promise<string | null> => {
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateStartProtocolTextTx(tx, workerId, text);
        return;
      }

      await this.createStartProtocolTextTx(tx, workerId, text);
    });

    return this.getStartProtocolText(workerId);
  };

  private async updateStartProtocolTextTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        generate_protocol_at_start: text || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createStartProtocolTextTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .insert(workerConfig)
      .values({
        worker_config_id: uuidv7(),
        worker_id: workerId,
        is_automatic_attendance: false,
        show_attendee_name: false,
        show_worker_name: false,
        allow_attendance_only_online: false,
        auto_save_contacts: false,
        generate_protocol_at_start: text || null,
      })
      .execute();
  }

  private async getStartProtocolText(workerId: string): Promise<string | null> {
    const result = await this.db
      .select({
        generate_protocol_at_start: workerConfig.generate_protocol_at_start,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0]?.generate_protocol_at_start || null;
  }

  updateSimultaneousAttendance = async (
    workerId: string,
    quantity: number | null
  ): Promise<number | null> => {
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateSimultaneousAttendanceTx(tx, workerId, quantity);
        return;
      }

      await this.createSimultaneousAttendanceTx(tx, workerId, quantity);
    });

    return this.getSimultaneousAttendance(workerId);
  };

  private async updateSimultaneousAttendanceTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    quantity: number | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        simultaneous_attendance: quantity || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createSimultaneousAttendanceTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    quantity: number | null
  ): Promise<void> {
    await tx
      .insert(workerConfig)
      .values({
        worker_config_id: uuidv7(),
        worker_id: workerId,
        is_automatic_attendance: false,
        show_attendee_name: false,
        show_worker_name: false,
        allow_attendance_only_online: false,
        auto_save_contacts: false,
        simultaneous_attendance: quantity || null,
      })
      .execute();
  }

  private async getSimultaneousAttendance(
    workerId: string
  ): Promise<number | null> {
    const result = await this.db
      .select({
        simultaneous_attendance: workerConfig.simultaneous_attendance,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0]?.simultaneous_attendance || null;
  }

  updateShowMessageOnCall = async (
    workerId: string,
    text: string | null
  ): Promise<string | null> => {
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateShowMessageOnCallTx(tx, workerId, text);
        return;
      }

      await this.createShowMessageOnCallTx(tx, workerId, text);
    });

    return this.getShowMessageOnCall(workerId);
  };

  private async updateShowMessageOnCallTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        show_message_on_call: text || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createShowMessageOnCallTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    text: string | null
  ): Promise<void> {
    await tx
      .insert(workerConfig)
      .values({
        worker_config_id: uuidv7(),
        worker_id: workerId,
        is_automatic_attendance: false,
        show_attendee_name: false,
        show_worker_name: false,
        allow_attendance_only_online: false,
        auto_save_contacts: false,
        show_message_on_call: text || null,
      })
      .execute();
  }

  private async getShowMessageOnCall(workerId: string): Promise<string | null> {
    const result = await this.db
      .select({
        show_message_on_call: workerConfig.show_message_on_call,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0]?.show_message_on_call || null;
  }

  updateChatbot = async (
    workerId: string,
    chatbotId: string | null
  ): Promise<string | null> => {
    await this.db.transaction(async (tx) => {
      await this.ensureSingleConfigPerWorker(tx, workerId);

      const existingConfig = await this.findExistingConfigTx(tx, workerId);

      if (existingConfig) {
        await this.updateChatbotTx(tx, workerId, chatbotId);
        return;
      }

      await this.createChatbotTx(tx, workerId, chatbotId);
    });

    return this.getChatbot(workerId);
  };

  private async updateChatbotTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    chatbotId: string | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        chatbot_id: chatbotId || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_id, workerId))
      .execute();
  }

  private async createChatbotTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    workerId: string,
    chatbotId: string | null
  ): Promise<void> {
    await tx
      .insert(workerConfig)
      .values({
        worker_config_id: uuidv7(),
        worker_id: workerId,
        is_automatic_attendance: false,
        show_attendee_name: false,
        show_worker_name: false,
        allow_attendance_only_online: false,
        auto_save_contacts: false,
        chatbot_id: chatbotId || null,
      })
      .execute();
  }

  private async getChatbot(workerId: string): Promise<string | null> {
    const result = await this.db
      .select({
        chatbot_id: workerConfig.chatbot_id,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0]?.chatbot_id || null;
  }
}
