import * as schema from '@core/models';
import { chatbot, workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';
import {
  OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES,
  parseOperatorReplyPendingAlertConfig,
} from '@core/common/functions/operatorReplyPendingAlertConfig';

@injectable()
export class WorkerConfigForChatViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigForChatByWorkerId = async (
    workerId: string
  ): Promise<ViewWorkerConfigForChatResponse> => {
    const [
      configMap,
      chatbotInputConfig,
      chatbotOutputConfig,
      aiAgentConfig,
      operatorReplyPendingAlertConfig,
    ] = await Promise.all([
      this.fetchActiveConfigs(workerId),
      this.fetchChatbotConfig(workerId, EWorkerConfigType.chatbot_id),
      this.fetchChatbotConfig(workerId, EWorkerConfigType.chatbot_output_id),
      this.fetchAiAgentConfig(workerId),
      this.fetchOperatorReplyPendingAlertConfig(workerId),
    ]);

    if (configMap.size === 0) {
      return null;
    }

    return this.buildConfigForChat(
      configMap,
      chatbotInputConfig,
      chatbotOutputConfig,
      aiAgentConfig,
      operatorReplyPendingAlertConfig
    );
  };

  private async fetchChatbotConfig(
    workerId: string,
    configType:
      EWorkerConfigType.chatbot_id | EWorkerConfigType.chatbot_output_id
  ): Promise<{
    chatbotId: string | null;
    name: string | null;
    type: EChatbotType | null;
    status: EChatbotStatus | null;
    enabled: boolean;
  } | null> {
    const result = await this.dbRo
      .select({
        chatbot_id: workerConfig.chatbot_id,
        worker_config_status_id: workerConfig.worker_config_status_id,
        name: chatbot.name,
        type: chatbot.type,
        status: chatbot.status,
      })
      .from(workerConfig)
      .leftJoin(chatbot, eq(workerConfig.chatbot_id, chatbot.chatbot_id))
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, configType)
        )
      )
      .limit(1)
      .execute();

    const row = result[0];
    if (!row) return null;

    return {
      chatbotId: row.chatbot_id,
      name: row.name,
      type: row.type ?? null,
      status: row.status ?? null,
      enabled: row.worker_config_status_id === EWorkerConfigStatus.active,
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
    chatbotInputConfig: {
      chatbotId: string | null;
      name: string | null;
      type: EChatbotType | null;
      status: EChatbotStatus | null;
      enabled: boolean;
    } | null,
    chatbotOutputConfig: {
      chatbotId: string | null;
      name: string | null;
      type: EChatbotType | null;
      status: EChatbotStatus | null;
      enabled: boolean;
    } | null,
    aiAgentConfig: { aiAgentId: string | null; enabled: boolean },
    operatorReplyPendingAlertConfig: {
      value: string | null;
      enabled: boolean;
    }
  ): ViewWorkerConfigForChatResponse {
    const simultaneousAttendance = this.parseNumber(
      configMap.get(EWorkerConfigType.simultaneous_attendance)
    );

    const inputChatbot =
      chatbotInputConfig?.enabled &&
      chatbotInputConfig.chatbotId &&
      chatbotInputConfig.name &&
      chatbotInputConfig.status === EChatbotStatus.active &&
      chatbotInputConfig.type === EChatbotType.input
        ? {
            chatbot_id: chatbotInputConfig.chatbotId,
            name: chatbotInputConfig.name,
            type: EChatbotType.input,
          }
        : null;

    const outputChatbot =
      chatbotOutputConfig?.enabled &&
      chatbotOutputConfig.chatbotId &&
      chatbotOutputConfig.name &&
      chatbotOutputConfig.status === EChatbotStatus.active &&
      chatbotOutputConfig.type === EChatbotType.output
        ? {
            chatbot_id: chatbotOutputConfig.chatbotId,
            name: chatbotOutputConfig.name,
            type: EChatbotType.output,
          }
        : null;

    const hasUraOutput = outputChatbot !== null;

    const parsedOperatorReplyPendingAlertConfig =
      parseOperatorReplyPendingAlertConfig(
        operatorReplyPendingAlertConfig.value,
        operatorReplyPendingAlertConfig.enabled
      );

    return {
      show_worker_name: configMap.has(EWorkerConfigType.show_worker_name)
        ? true
        : false,
      show_attendee_name: configMap.has(EWorkerConfigType.show_attendee_name)
        ? true
        : false,
      show_protocol_in_chat: configMap.has(
        EWorkerConfigType.show_protocol_in_chat
      )
        ? true
        : false,
      send_message_on_finish_attendance_enabled: configMap.has(
        EWorkerConfigType.send_message_on_finish_attendance
      )
        ? true
        : false,
      send_message_on_transfer_enabled:
        configMap.has(EWorkerConfigType.generate_protocol_at_transfer) ||
        configMap.has(EWorkerConfigType.generate_protocol_at_transfer_sector) ||
        configMap.has(
          EWorkerConfigType.generate_protocol_at_transfer_sector_and_user
        ),
      allow_attendance_only_online: configMap.has(
        EWorkerConfigType.allow_attendance_only_online
      )
        ? true
        : false,
      simultaneous_attendance: simultaneousAttendance,
      simultaneous_attendance_enabled:
        simultaneousAttendance !== null && simultaneousAttendance > 0,
      attendance_inactivity_alert_enabled: configMap.has(
        EWorkerConfigType.attendance_inactivity_alert
      )
        ? true
        : false,
      operator_reply_pending_alert_enabled:
        parsedOperatorReplyPendingAlertConfig.enabled,
      operator_reply_pending_alert_time_minutes:
        parsedOperatorReplyPendingAlertConfig.time_minutes,
      has_ura_output: hasUraOutput,
      input_chatbot: inputChatbot,
      output_chatbot: outputChatbot,
      ai_agent_enabled: aiAgentConfig.enabled,
      ai_agent_id: aiAgentConfig.aiAgentId,
    };
  }

  private async fetchOperatorReplyPendingAlertConfig(
    workerId: string
  ): Promise<{
    value: string | null;
    enabled: boolean;
  }> {
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
            EWorkerConfigType.operator_reply_pending_alert
          )
        )
      )
      .limit(1)
      .execute();

    const row = result[0];
    if (!row) {
      return {
        value: JSON.stringify({
          time_minutes: OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES,
        }),
        enabled: false,
      };
    }

    return {
      value: row.value ?? null,
      enabled: row.worker_config_status_id === EWorkerConfigStatus.active,
    };
  }

  private async fetchAiAgentConfig(
    workerId: string
  ): Promise<{ aiAgentId: string | null; enabled: boolean }> {
    const result = await this.dbRo
      .select({
        ai_agent_id: workerConfig.ai_agent_id,
        worker_config_status_id: workerConfig.worker_config_status_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_type_id, EWorkerConfigType.ai_agent_id)
        )
      )
      .limit(1)
      .execute();

    const row = result[0];
    if (!row) {
      return { aiAgentId: null, enabled: false };
    }

    return {
      aiAgentId: row.ai_agent_id ?? null,
      enabled:
        row.worker_config_status_id === EWorkerConfigStatus.active &&
        !!row.ai_agent_id,
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
