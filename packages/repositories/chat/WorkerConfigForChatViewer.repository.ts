import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';

@injectable()
export class WorkerConfigForChatViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigForChatByWorkerId = async (
    workerId: string
  ): Promise<ViewWorkerConfigForChatResponse> => {
    const [configMap, chatbotOutputConfig] = await Promise.all([
      this.fetchActiveConfigs(workerId),
      this.fetchChatbotOutputConfig(workerId),
    ]);

    if (configMap.size === 0) {
      return null;
    }

    return this.buildConfigForChat(configMap, chatbotOutputConfig);
  };

  private async fetchChatbotOutputConfig(
    workerId: string
  ): Promise<{ chatbotId: string | null; statusId: string } | null> {
    const result = await this.dbRo
      .select({
        chatbot_id: workerConfig.chatbot_id,
        worker_config_status_id: workerConfig.worker_config_status_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(
            workerConfig.worker_config_type_id,
            EWorkerConfigType.chatbot_output_id
          )
        )
      )
      .limit(1)
      .execute();

    const row = result[0];
    if (!row) return null;

    return {
      chatbotId: row.chatbot_id,
      statusId: row.worker_config_status_id,
    };
  }

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

  private buildConfigForChat(
    configMap: Map<EWorkerConfigType, string | null>,
    chatbotOutputConfig: { chatbotId: string | null; statusId: string } | null
  ): ViewWorkerConfigForChatResponse {
    const simultaneousAttendance = this.parseNumber(
      configMap.get(EWorkerConfigType.simultaneous_attendance)
    );

    const hasUraOutput = !!(
      chatbotOutputConfig &&
      chatbotOutputConfig.chatbotId &&
      String(chatbotOutputConfig.chatbotId).trim().length > 0
    );

    return {
      show_worker_name: configMap.has(EWorkerConfigType.show_worker_name)
        ? true
        : false,
      show_attendee_name: configMap.has(EWorkerConfigType.show_attendee_name)
        ? true
        : false,
      allow_attendance_only_online: configMap.has(
        EWorkerConfigType.allow_attendance_only_online
      )
        ? true
        : false,
      simultaneous_attendance: simultaneousAttendance,
      simultaneous_attendance_enabled:
        simultaneousAttendance !== null && simultaneousAttendance > 0,
      has_ura_output: hasUraOutput,
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
