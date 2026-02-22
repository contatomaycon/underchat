import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { Transaction } from '@core/common/types/Transaction.type';

@injectable()
export class WorkerConfigUpserterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  upsertWorkerConfig = async (
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> => {
    await this.dbRw.transaction(async (tx) => {
      if (input.show_attendee_name !== undefined) {
        await this.upsertBooleanConfig(
          tx,
          workerId,
          EWorkerConfigType.show_attendee_name,
          input.show_attendee_name
        );
      }

      if (input.show_worker_name !== undefined) {
        await this.upsertBooleanConfig(
          tx,
          workerId,
          EWorkerConfigType.show_worker_name,
          input.show_worker_name
        );
      }

      if (input.allow_attendance_only_online !== undefined) {
        await this.upsertBooleanConfig(
          tx,
          workerId,
          EWorkerConfigType.allow_attendance_only_online,
          input.allow_attendance_only_online
        );
      }

      if (input.reject_call !== undefined) {
        await this.upsertBooleanConfig(
          tx,
          workerId,
          EWorkerConfigType.reject_call,
          input.reject_call
        );
      }

      if (input.auto_save_contacts !== undefined) {
        await this.upsertBooleanConfig(
          tx,
          workerId,
          EWorkerConfigType.auto_save_contacts,
          input.auto_save_contacts
        );
      }

      if (input.proxy_enabled !== undefined) {
        await this.upsertProxyConfig(tx, workerId, input);
      }
    });
  };

  updateTransferProtocolText = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.generate_protocol_at_transfer,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.generate_protocol_at_transfer
    );
  };

  updateTransferProtocolSectorText = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.generate_protocol_at_transfer_sector,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.generate_protocol_at_transfer_sector
    );
  };

  updateTransferProtocolSectorAndUserText = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.generate_protocol_at_transfer_sector_and_user,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.generate_protocol_at_transfer_sector_and_user
    );
  };

  updateStartProtocolText = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.generate_protocol_at_start,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.generate_protocol_at_start
    );
  };

  updateSimultaneousAttendance = async (
    workerId: string,
    quantity: number | null,
    statusId: string
  ): Promise<number | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.simultaneous_attendance,
        quantity !== null ? quantity.toString() : null
      );
    });

    const value = await this.getConfigValue(
      workerId,
      EWorkerConfigType.simultaneous_attendance
    );

    return value !== null ? parseInt(value, 10) : null;
  };

  updateShowMessageOnCall = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.show_message_on_call,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.show_message_on_call
    );
  };

  updateSendMessageOnFinishAttendance = async (
    workerId: string,
    text: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      await this.upsertConfigValue(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.send_message_on_finish_attendance,
        text
      );
    });

    return this.getConfigValue(
      workerId,
      EWorkerConfigType.send_message_on_finish_attendance
    );
  };

  updateChatbot = async (
    workerId: string,
    chatbotId: string | null,
    statusId: string
  ): Promise<string | null> => {
    await this.dbRw.transaction(async (tx) => {
      const existing = await this.findConfigByWorkerAndTypeId(
        tx,
        workerId,
        EWorkerConfigType.chatbot_id
      );

      if (existing) {
        await this.updateChatbotId(
          tx,
          existing.worker_config_id,
          chatbotId,
          statusId
        );
        return;
      }

      await this.createChatbotConfig(
        tx,
        workerId,
        statusId,
        EWorkerConfigType.chatbot_id,
        chatbotId
      );
    });

    return this.getChatbotId(workerId);
  };

  private async updateChatbotId(
    tx: Transaction,
    configId: string,
    chatbotId: string | null,
    statusId: string
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        worker_config_status_id: statusId,
        chatbot_id: chatbotId,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_config_id, configId))
      .execute();
  }

  private async createChatbotConfig(
    tx: Transaction,
    workerId: string,
    statusId: string,
    typeId: string,
    chatbotId: string | null
  ): Promise<void> {
    await tx.insert(workerConfig).values({
      worker_config_id: uuidv7(),
      worker_id: workerId,
      worker_config_status_id: statusId,
      worker_config_type_id: typeId,
      chatbot_id: chatbotId,
      value: null,
    });
  }

  private async findConfigByWorkerAndTypeId(
    tx: Transaction,
    workerId: string,
    typeId: string
  ): Promise<{
    worker_config_id: string;
    worker_config_status_id: string;
  } | null> {
    const result = await tx
      .select({
        worker_config_id: workerConfig.worker_config_id,
        worker_config_status_id: workerConfig.worker_config_status_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, typeId)
        )
      )
      .limit(1)
      .execute();

    return result[0] || null;
  }

  private async upsertBooleanConfig(
    tx: Transaction,
    workerId: string,
    type: EWorkerConfigType,
    isActive: boolean
  ): Promise<void> {
    const activeStatusId = EWorkerConfigStatus.active;
    const inactiveStatusId = EWorkerConfigStatus.inactive;

    const existingConfig = await this.findConfigByWorkerAndTypeId(
      tx,
      workerId,
      type
    );

    if (existingConfig) {
      const targetStatusId = isActive ? activeStatusId : inactiveStatusId;
      await this.updateConfigStatus(
        tx,
        existingConfig.worker_config_id,
        targetStatusId,
        null
      );
      return;
    }

    const targetStatusId = isActive ? activeStatusId : inactiveStatusId;
    await this.createBooleanConfig(tx, workerId, targetStatusId, type);
  }

  private async upsertProxyConfig(
    tx: Transaction,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<void> {
    const enabled = Boolean(input.proxy_enabled);
    const targetStatusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    await this.upsertBooleanConfig(
      tx,
      workerId,
      EWorkerConfigType.proxy_enabled,
      enabled
    );

    await this.upsertConfigValue(
      tx,
      workerId,
      targetStatusId,
      EWorkerConfigType.proxy_host,
      input.proxy_host?.trim() || null
    );

    await this.upsertConfigValue(
      tx,
      workerId,
      targetStatusId,
      EWorkerConfigType.proxy_port,
      input.proxy_port ? input.proxy_port.toString() : null
    );

    await this.upsertConfigValue(
      tx,
      workerId,
      targetStatusId,
      EWorkerConfigType.proxy_username,
      input.proxy_username?.trim() || null
    );

    await this.upsertConfigValue(
      tx,
      workerId,
      targetStatusId,
      EWorkerConfigType.proxy_password,
      input.proxy_password?.trim() || null
    );
  }

  private async updateConfigStatus(
    tx: Transaction,
    configId: string,
    statusId: string,
    value: string | null
  ): Promise<void> {
    await tx
      .update(workerConfig)
      .set({
        worker_config_status_id: statusId,
        value: value,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_config_id, configId))
      .execute();
  }

  private async createBooleanConfig(
    tx: Transaction,
    workerId: string,
    statusId: string,
    typeId: string
  ): Promise<void> {
    await tx.insert(workerConfig).values({
      worker_config_id: uuidv7(),
      worker_id: workerId,
      worker_config_status_id: statusId,
      worker_config_type_id: typeId,
      value: null,
      chatbot_id: null,
    });
  }

  private async upsertConfigValue(
    tx: Transaction,
    workerId: string,
    statusId: string,
    type: EWorkerConfigType,
    value: string | null
  ): Promise<void> {
    const existing = await this.findConfigByWorkerAndTypeId(tx, workerId, type);

    if (existing) {
      await this.updateConfigValue(
        tx,
        existing.worker_config_id,
        statusId,
        value
      );
      return;
    }

    await this.createConfigValue(tx, workerId, statusId, type, value);
  }

  private async getConfigValueById(
    tx: Transaction,
    configId: string
  ): Promise<string | null> {
    const result = await tx
      .select({
        value: workerConfig.value,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_config_id, configId))
      .limit(1)
      .execute();

    return result[0]?.value || null;
  }

  private async updateConfigValue(
    tx: Transaction,
    configId: string,
    statusId: string,
    newValue: string | null
  ): Promise<void> {
    const currentValue = await this.getConfigValueById(tx, configId);

    await tx
      .update(workerConfig)
      .set({
        worker_config_status_id: statusId,
        value: newValue !== null ? newValue : currentValue,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.worker_config_id, configId))
      .execute();
  }

  private async createConfigValue(
    tx: Transaction,
    workerId: string,
    statusId: string,
    typeId: string,
    value: string | null
  ): Promise<void> {
    await tx.insert(workerConfig).values({
      worker_config_id: uuidv7(),
      worker_id: workerId,
      worker_config_status_id: statusId,
      worker_config_type_id: typeId,
      value: value,
      chatbot_id: null,
    });
  }

  private async getConfigValue(
    workerId: string,
    type: EWorkerConfigType
  ): Promise<string | null> {
    const result = await this.dbRo
      .select({
        value: workerConfig.value,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, type)
        )
      )
      .limit(1)
      .execute();

    return result[0]?.value || null;
  }

  private async getChatbotId(workerId: string): Promise<string | null> {
    const result = await this.dbRo
      .select({
        chatbot_id: workerConfig.chatbot_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, EWorkerConfigType.chatbot_id)
        )
      )
      .limit(1)
      .execute();

    return result[0]?.chatbot_id || null;
  }

  updateChatbots = async (
    workerId: string,
    chatbotId: string | null,
    outputChatbotId: string | null,
    statusId: string
  ): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
  }> => {
    const outputStatus =
      outputChatbotId !== null &&
      outputChatbotId !== undefined &&
      String(outputChatbotId).trim().length > 0
        ? EWorkerConfigStatus.active
        : statusId;

    await this.dbRw.transaction(async (tx) => {
      await this.upsertInputChatbot(tx, workerId, chatbotId, statusId);
      await this.upsertOutputChatbot(
        tx,
        workerId,
        outputChatbotId,
        outputStatus
      );
    });

    const chatbotIdResult = await this.getChatbotId(workerId);
    const outputId = await this.getChatbotIdByType(
      workerId,
      EWorkerConfigType.chatbot_output_id
    );

    return {
      chatbot_id: chatbotIdResult,
      output_chatbot_id: outputId,
    };
  };

  private async upsertInputChatbot(
    tx: Transaction,
    workerId: string,
    chatbotId: string | null,
    statusId: string
  ): Promise<void> {
    const existing = await this.findConfigByWorkerAndTypeId(
      tx,
      workerId,
      EWorkerConfigType.chatbot_id
    );

    if (existing) {
      await this.updateChatbotId(
        tx,
        existing.worker_config_id,
        chatbotId,
        statusId
      );
      return;
    }

    await this.createChatbotConfig(
      tx,
      workerId,
      statusId,
      EWorkerConfigType.chatbot_id,
      chatbotId
    );
  }

  private async upsertOutputChatbot(
    tx: Transaction,
    workerId: string,
    outputChatbotId: string | null,
    statusId: string
  ): Promise<void> {
    const existing = await this.findConfigByWorkerAndTypeId(
      tx,
      workerId,
      EWorkerConfigType.chatbot_output_id
    );

    if (existing) {
      await this.updateChatbotId(
        tx,
        existing.worker_config_id,
        outputChatbotId,
        statusId
      );
      return;
    }

    await this.createChatbotConfig(
      tx,
      workerId,
      statusId,
      EWorkerConfigType.chatbot_output_id,
      outputChatbotId
    );
  }

  private async getChatbotIdByType(
    workerId: string,
    typeId: string
  ): Promise<string | null> {
    const result = await this.dbRo
      .select({
        chatbot_id: workerConfig.chatbot_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, typeId)
        )
      )
      .limit(1)
      .execute();

    return result[0]?.chatbot_id || null;
  }
}
