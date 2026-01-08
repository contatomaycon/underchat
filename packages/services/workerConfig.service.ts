import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { WorkerConfigUpserterRepository } from '@core/repositories/worker/WorkerConfigUpserter.repository';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';
import { IWorkerConfigValue } from '@core/common/interfaces/IWorkerConfigValue';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import Redis from 'ioredis';
import { StreamProducerService } from './streamProducer.service';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { IWorkerConfigUpdateEvent } from '@core/common/interfaces/IWorkerConfigUpdateEvent';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { AiAgentService } from './aiAgent.service';

@injectable()
export class WorkerConfigService {
  constructor(
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    private readonly workerConfigUpserterRepository: WorkerConfigUpserterRepository,
    private readonly aiAgentService: AiAgentService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async viewWorkerConfig(workerId: string): Promise<ViewWorkerConfigResponse> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return this.mapToWorkerConfig(result);
  }

  async upsertWorkerConfig(
    t: TFunction<'translation', undefined>,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<WorkerConfig> {
    await this.workerConfigUpserterRepository.upsertWorkerConfig(
      workerId,
      input
    );

    await this.invalidateWorkerConfigCache(workerId);

    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return this.mapToWorkerConfig({
        worker_config_id: '',
        worker_id: workerId,
        is_automatic_attendance: null,
        show_attendee_name: null,
        show_worker_name: null,
        allow_attendance_only_online: null,
        simultaneous_attendance: null,
        generate_protocol_at_start: null,
        generate_protocol_at_transfer: null,
        show_message_on_call: null,
        send_message_on_finish_attendance: null,
        reject_call: null,
        auto_save_contacts: null,
        chatbot_id: null,
        ai_agent: null,
        created_at: null,
        updated_at: null,
      });
    }

    if (input.reject_call !== undefined) {
      const updateEvent: IWorkerConfigUpdateEvent = {
        worker_id: workerId,
        reject_call: input.reject_call,
      };

      try {
        await this.streamProducerService.send(
          this.kafkaServiceQueueService.workerConfigUpdate(),
          updateEvent
        );
      } catch (error) {
        console.error('Error sending worker config update event:', error);
      }
    }

    return this.mapToWorkerConfig(result);
  }

  private mapToWorkerConfig(result: IWorkerConfigValue): WorkerConfig {
    return {
      worker_config_id: result.worker_config_id,
      worker_id: result.worker_id,
      is_automatic_attendance: result.is_automatic_attendance ?? false,
      show_attendee_name: result.show_attendee_name ?? false,
      show_worker_name: result.show_worker_name ?? false,
      allow_attendance_only_online:
        result.allow_attendance_only_online ?? false,
      simultaneous_attendance: result.simultaneous_attendance ?? null,
      generate_protocol_at_start: result.generate_protocol_at_start,
      generate_protocol_at_transfer: result.generate_protocol_at_transfer,
      show_message_on_call: result.show_message_on_call,
      send_message_on_finish_attendance:
        result.send_message_on_finish_attendance,
      reject_call: result.reject_call ?? false,
      auto_save_contacts: result.auto_save_contacts ?? false,
      chatbot_id: result.chatbot_id ?? null,
      ai_agent: result.ai_agent ?? null,
      created_at: result.created_at ?? null,
      updated_at: result.updated_at ?? null,
    };
  }

  async updateTransferProtocolText(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    generate_protocol_at_transfer: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewTransferProtocolText(workerId);
    const textToSave =
      text !== null ? text : currentConfig.generate_protocol_at_transfer;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateTransferProtocolText(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      generate_protocol_at_transfer: result,
      enabled,
    };
  }

  async viewTransferProtocolText(workerId: string): Promise<{
    generate_protocol_at_transfer: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.generate_protocol_at_transfer
      );

    const protocolText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      protocolText !== null &&
      protocolText.trim().length > 0;

    return {
      generate_protocol_at_transfer: protocolText,
      enabled,
    };
  }

  async updateTransferProtocolSectorText(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    generate_protocol_at_transfer_sector: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewTransferProtocolSectorText(workerId);
    const textToSave =
      text !== null ? text : currentConfig.generate_protocol_at_transfer_sector;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateTransferProtocolSectorText(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      generate_protocol_at_transfer_sector: result,
      enabled,
    };
  }

  async viewTransferProtocolSectorText(workerId: string): Promise<{
    generate_protocol_at_transfer_sector: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.generate_protocol_at_transfer_sector
      );

    const protocolText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      protocolText !== null &&
      protocolText.trim().length > 0;

    return {
      generate_protocol_at_transfer_sector: protocolText,
      enabled,
    };
  }

  async updateTransferProtocolSectorAndUserText(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    generate_protocol_at_transfer_sector_and_user: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig =
      await this.viewTransferProtocolSectorAndUserText(workerId);
    const textToSave =
      text !== null
        ? text
        : currentConfig.generate_protocol_at_transfer_sector_and_user;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateTransferProtocolSectorAndUserText(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      generate_protocol_at_transfer_sector_and_user: result,
      enabled,
    };
  }

  async viewTransferProtocolSectorAndUserText(workerId: string): Promise<{
    generate_protocol_at_transfer_sector_and_user: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.generate_protocol_at_transfer_sector_and_user
      );

    const protocolText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      protocolText !== null &&
      protocolText.trim().length > 0;

    return {
      generate_protocol_at_transfer_sector_and_user: protocolText,
      enabled,
    };
  }

  async updateStartProtocolText(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    generate_protocol_at_start: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewStartProtocolText(workerId);
    const textToSave =
      text !== null ? text : currentConfig.generate_protocol_at_start;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateStartProtocolText(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      generate_protocol_at_start: result,
      enabled,
    };
  }

  async viewStartProtocolText(workerId: string): Promise<{
    generate_protocol_at_start: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.generate_protocol_at_start
      );

    const protocolText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      protocolText !== null &&
      protocolText.trim().length > 0;

    return {
      generate_protocol_at_start: protocolText,
      enabled,
    };
  }

  async updateSimultaneousAttendance(
    workerId: string,
    quantity: number | null,
    enabled: boolean
  ): Promise<{
    simultaneous_attendance: number | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewSimultaneousAttendance(workerId);
    const quantityToSave =
      quantity !== null
        ? quantity
        : currentConfig.simultaneous_attendance !== null
          ? currentConfig.simultaneous_attendance
          : null;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateSimultaneousAttendance(
        workerId,
        quantityToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      simultaneous_attendance: result,
      enabled,
    };
  }

  async viewSimultaneousAttendance(
    workerId: string
  ): Promise<{ simultaneous_attendance: number | null; enabled: boolean }> {
    const config =
      await this.workerConfigViewerRepository.fetchSimultaneousAttendanceValue(
        workerId
      );

    const attendance =
      config.value !== null ? parseInt(config.value, 10) : null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      attendance !== null &&
      !isNaN(attendance) &&
      attendance > 0;

    return {
      simultaneous_attendance:
        attendance !== null && !isNaN(attendance) ? attendance : null,
      enabled,
    };
  }

  async updateShowMessageOnCall(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    show_message_on_call: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewShowMessageOnCall(workerId);
    const textToSave =
      text !== null ? text : currentConfig.show_message_on_call;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateShowMessageOnCall(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      show_message_on_call: result,
      enabled,
    };
  }

  async viewShowMessageOnCall(workerId: string): Promise<{
    show_message_on_call: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.show_message_on_call
      );

    const messageText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      messageText !== null &&
      messageText.trim().length > 0;

    return {
      show_message_on_call: messageText,
      enabled,
    };
  }

  async updateSendMessageOnFinishAttendance(
    workerId: string,
    text: string | null,
    enabled: boolean
  ): Promise<{
    send_message_on_finish_attendance: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig =
      await this.viewSendMessageOnFinishAttendance(workerId);
    const textToSave =
      text !== null ? text : currentConfig.send_message_on_finish_attendance;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateSendMessageOnFinishAttendance(
        workerId,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      send_message_on_finish_attendance: result,
      enabled,
    };
  }

  async viewSendMessageOnFinishAttendance(workerId: string): Promise<{
    send_message_on_finish_attendance: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.send_message_on_finish_attendance
      );

    const messageText = config.value || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      messageText !== null &&
      messageText.trim().length > 0;

    return {
      send_message_on_finish_attendance: messageText,
      enabled,
    };
  }

  async updateChatbot(
    workerId: string,
    chatbotId: string | null,
    enabled: boolean
  ): Promise<{
    chatbot_id: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewChatbot(workerId);
    const chatbotIdToSave =
      chatbotId !== null ? chatbotId : currentConfig.chatbot_id;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateChatbot(
        workerId,
        chatbotIdToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      chatbot_id: result,
      enabled,
    };
  }

  async viewChatbot(workerId: string): Promise<{
    chatbot_id: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchChatbotValue(workerId);

    const chatbotId = config.chatbotId || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      chatbotId !== null &&
      chatbotId.trim().length > 0;

    return {
      chatbot_id: chatbotId,
      enabled,
    };
  }

  async viewAiAgentConfigByAccountId(accountId: string): Promise<{
    ai_agent: number | null;
    enabled: boolean;
    total: number;
  }> {
    const [config, total] = await Promise.all([
      this.workerConfigViewerRepository.fetchConfigValueByAccountId(
        accountId,
        EWorkerConfigType.ai_agent
      ),
      this.aiAgentService.totalAiAgentByAccountId(accountId),
    ]);

    const aiAgentValue =
      config.value !== null ? parseInt(config.value, 10) : null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      aiAgentValue !== null &&
      !isNaN(aiAgentValue) &&
      aiAgentValue > 0;

    return {
      ai_agent:
        aiAgentValue !== null && !isNaN(aiAgentValue) ? aiAgentValue : null,
      enabled,
      total,
    };
  }

  async viewChatbotConfigByAccountId(accountId: string): Promise<{
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByAccountId(
        accountId,
        EWorkerConfigType.chatbot_id
      );

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      config.value !== null &&
      config.value.trim().length > 0;

    return {
      enabled,
    };
  }

  private async invalidateWorkerConfigCache(workerId: string): Promise<void> {
    await this.redis.del(`worker:${workerId}:config_fields`);
  }
}
