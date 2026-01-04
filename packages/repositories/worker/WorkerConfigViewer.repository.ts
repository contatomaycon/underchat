import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { IWorkerConfigValue } from '@core/common/interfaces/IWorkerConfigValue';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';

@injectable()
export class WorkerConfigViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigValue | null> => {
    const configMap = await this.fetchActiveConfigs(workerId);
    const chatbotId = await this.fetchChatbotId(workerId);

    if (configMap.size === 0 && !chatbotId) {
      return null;
    }

    return this.buildConfigValue(workerId, configMap, chatbotId);
  };

  private async fetchActiveConfigs(
    workerId: string
  ): Promise<Map<EWorkerConfigType, string | null>> {
    const result = await this.dbRo
      .select({
        value: workerConfig.value,
        worker_config_type_id: workerConfig.worker_config_type_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_status_id, EWorkerConfigStatus.active)
        )
      )
      .execute();

    const configMap = new Map<EWorkerConfigType, string | null>();
    for (const row of result) {
      configMap.set(row.worker_config_type_id as EWorkerConfigType, row.value);
    }

    return configMap;
  }

  private async fetchChatbotId(workerId: string): Promise<string | null> {
    const result = await this.dbRo
      .select({
        chatbot_id: workerConfig.chatbot_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_status_id, EWorkerConfigStatus.active),
          eq(workerConfig.worker_config_type_id, EWorkerConfigType.chatbot_id)
        )
      )
      .limit(1)
      .execute();

    return result[0]?.chatbot_id || null;
  }

  async fetchSimultaneousAttendanceValue(
    workerId: string
  ): Promise<{ value: string | null; statusId: string | null }> {
    const result = await this.dbRo
      .select({
        value: workerConfig.value,
        worker_config_status_id: workerConfig.worker_config_status_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(
            workerConfig.worker_config_type_id,
            EWorkerConfigType.simultaneous_attendance
          )
        )
      )
      .limit(1)
      .execute();

    return {
      value: result[0]?.value || null,
      statusId: result[0]?.worker_config_status_id || null,
    };
  }

  private buildConfigValue(
    workerId: string,
    configMap: Map<EWorkerConfigType, string | null>,
    chatbotId: string | null
  ): IWorkerConfigValue {
    return {
      worker_config_id: '',
      worker_id: workerId,
      is_automatic_attendance: configMap.has(
        EWorkerConfigType.is_automatic_attendance
      )
        ? true
        : null,
      show_attendee_name: configMap.has(EWorkerConfigType.show_attendee_name)
        ? true
        : null,
      show_worker_name: configMap.has(EWorkerConfigType.show_worker_name)
        ? true
        : null,
      allow_attendance_only_online: configMap.has(
        EWorkerConfigType.allow_attendance_only_online
      )
        ? true
        : null,
      simultaneous_attendance: this.parseNumber(
        configMap.get(EWorkerConfigType.simultaneous_attendance)
      ),
      generate_protocol_at_start:
        configMap.get(EWorkerConfigType.generate_protocol_at_start) || null,
      generate_protocol_at_transfer:
        configMap.get(EWorkerConfigType.generate_protocol_at_transfer) || null,
      show_message_on_call:
        configMap.get(EWorkerConfigType.show_message_on_call) || null,
      send_message_on_finish_attendance:
        configMap.get(EWorkerConfigType.send_message_on_finish_attendance) ||
        null,
      reject_call: configMap.has(EWorkerConfigType.reject_call) ? true : null,
      auto_save_contacts: configMap.has(EWorkerConfigType.auto_save_contacts)
        ? true
        : null,
      chatbot_id: chatbotId,
      created_at: null,
      updated_at: null,
    };
  }

  private parseNumber(value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
}
