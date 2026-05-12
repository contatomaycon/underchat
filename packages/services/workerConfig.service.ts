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
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { IAttendanceHoursConfig } from '@core/common/interfaces/IAttendanceHours';
import { parseAttendanceHoursConfig } from '@core/common/functions/attendanceHoursConfig';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { IAttendanceInactivityAlertConfig } from '@core/common/interfaces/IAttendanceInactivityAlert';
import { parseAttendanceInactivityAlertConfig } from '@core/common/functions/attendanceInactivityAlertConfig';
import {
  CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE,
  normalizeChatbotWorkingHoursTimezone,
} from '@core/common/functions/chatbotWorkingHours';
import { IChatbotWorkingHoursRule } from '@core/common/interfaces/IChatbotWorkingHours';
import {
  DEFAULT_TYPING_SIMULATION_SPEED,
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
  defaultTypingSimulationConfig,
  isValidTypingSimulationSpeed,
  normalizeTypingSimulationSpeed,
  typingSimulationCacheKey,
} from '@core/common/functions/typingSimulationConfig';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import { IOperatorReplyPendingAlertConfig } from '@core/common/interfaces/IOperatorReplyPendingAlertConfig';
import { parseOperatorReplyPendingAlertConfig } from '@core/common/functions/operatorReplyPendingAlertConfig';
import {
  ISecurityKeyConfig,
  TSecurityKeyScope,
} from '@core/common/interfaces/ISecurityKeyConfig';
import { defaultSecurityKeyConfig } from '@core/common/functions/securityKeyConfig';

@injectable()
export class WorkerConfigService {
  constructor(
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    @inject(WorkerConfigUpserterRepository)
    private readonly workerConfigUpserterRepository: WorkerConfigUpserterRepository,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private normalizeProxyProtocol(
    protocol: string | null | undefined
  ): EProxyProtocol {
    if (!protocol) {
      return EProxyProtocol.http;
    }

    if (Object.values(EProxyProtocol).includes(protocol as EProxyProtocol)) {
      return protocol as EProxyProtocol;
    }

    return EProxyProtocol.http;
  }

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
    const normalizedInput = this.normalizeWorkerConfigInput(input);

    await this.workerConfigUpserterRepository.upsertWorkerConfig(
      workerId,
      normalizedInput
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
        show_attendee_name: null,
        show_worker_name: null,
        show_protocol_in_chat: null,
        allow_attendance_only_online: null,
        simultaneous_attendance: null,
        generate_protocol_at_start: null,
        generate_protocol_at_transfer: null,
        show_message_on_call: null,
        send_message_on_finish_attendance: null,
        reject_call: null,
        auto_save_contacts: null,
        mark_as_read: null,
        chatbot_id: null,
        proxy_enabled: null,
        proxy_protocol: null,
        proxy_host: null,
        proxy_port: null,
        proxy_username: null,
        proxy_password: null,
        created_at: null,
        updated_at: null,
      });
    }

    if (normalizedInput.reject_call !== undefined) {
      const updateEvent: IWorkerConfigUpdateEvent = {
        worker_id: workerId,
        reject_call: normalizedInput.reject_call,
      };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.workerConfigUpdate(),
        updateEvent
      );
    }

    return this.mapToWorkerConfig(result);
  }

  private mapToWorkerConfig(result: IWorkerConfigValue): WorkerConfig {
    return {
      worker_config_id: result.worker_config_id,
      worker_id: result.worker_id,
      show_attendee_name: result.show_attendee_name ?? false,
      show_worker_name: result.show_worker_name ?? false,
      show_protocol_in_chat: result.show_protocol_in_chat ?? false,
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
      mark_as_read: result.mark_as_read ?? false,
      chatbot_id: result.chatbot_id ?? null,
      proxy_enabled: result.proxy_enabled ?? false,
      proxy_protocol: this.normalizeProxyProtocol(result.proxy_protocol),
      proxy_host: result.proxy_host ?? null,
      proxy_port: result.proxy_port ?? null,
      proxy_username: this.decryptProxyField(result.proxy_username),
      proxy_password: this.decryptProxyField(result.proxy_password),
      created_at: result.created_at ?? null,
      updated_at: result.updated_at ?? null,
    };
  }

  private normalizeWorkerConfigInput(
    input: IUpdateWorkerConfig
  ): IUpdateWorkerConfig {
    const normalizedInput: IUpdateWorkerConfig = {
      ...input,
    };

    if (input.proxy_enabled === undefined) {
      return normalizedInput;
    }

    if (!input.proxy_enabled) {
      normalizedInput.proxy_protocol = null;
      normalizedInput.proxy_host = null;
      normalizedInput.proxy_port = null;
      normalizedInput.proxy_username = null;
      normalizedInput.proxy_password = null;
      return normalizedInput;
    }

    if (
      !input.proxy_host?.trim() ||
      !input.proxy_port ||
      !Number.isFinite(input.proxy_port) ||
      input.proxy_port <= 0
    ) {
      throw new Error('Proxy configuration is incomplete');
    }

    normalizedInput.proxy_protocol = this.normalizeProxyProtocol(
      input.proxy_protocol
    );
    normalizedInput.proxy_host = input.proxy_host?.trim() ?? null;
    normalizedInput.proxy_port = input.proxy_port ?? null;

    normalizedInput.proxy_username = this.encryptProxyField(
      input.proxy_username
    );
    normalizedInput.proxy_password = this.encryptProxyField(
      input.proxy_password
    );

    return normalizedInput;
  }

  private encryptProxyField(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return this.passwordEncryptorService.encrypt(trimmed);
  }

  private decryptProxyField(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      return this.passwordEncryptorService.decrypt(value);
    } catch {
      return value;
    }
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

  async ensureTypingSimulationDefault(
    workerId: string
  ): Promise<ITypingSimulationConfig> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.typing_simulation
      );

    if (config.statusId) {
      const current = await this.viewTypingSimulation(workerId);
      await this.cacheTypingSimulationConfig(workerId, current);
      return current;
    }

    return this.updateTypingSimulation(
      workerId,
      DEFAULT_TYPING_SIMULATION_SPEED,
      true
    );
  }

  async ensureSecurityKeyDefault(
    workerId: string
  ): Promise<ISecurityKeyConfig> {
    const [securityKey, chatbot, schedule, quickMessage] = await Promise.all([
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_chatbot
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_schedule
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_quick_message
      ),
    ]);

    if (
      securityKey.statusId &&
      chatbot.statusId &&
      schedule.statusId &&
      quickMessage.statusId
    ) {
      return this.viewSecurityKey(workerId);
    }

    return this.updateSecurityKey(workerId, defaultSecurityKeyConfig());
  }

  async updateSecurityKey(
    workerId: string,
    input: ISecurityKeyConfig
  ): Promise<ISecurityKeyConfig> {
    const normalizedInput = this.normalizeSecurityKeyConfig(input);

    await Promise.all([
      this.workerConfigUpserterRepository.updateSecurityKey(
        workerId,
        normalizedInput
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return normalizedInput;
  }

  async viewSecurityKey(workerId: string): Promise<ISecurityKeyConfig> {
    const defaultConfig = defaultSecurityKeyConfig();
    const [securityKey, chatbot, schedule, quickMessage] = await Promise.all([
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_chatbot
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_schedule
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.security_key_quick_message
      ),
    ]);

    const config = {
      enabled: securityKey.statusId
        ? securityKey.statusId === EWorkerConfigStatus.active
        : defaultConfig.enabled,
      chatbot: chatbot.statusId
        ? chatbot.statusId === EWorkerConfigStatus.active
        : defaultConfig.chatbot,
      schedule: schedule.statusId
        ? schedule.statusId === EWorkerConfigStatus.active
        : defaultConfig.schedule,
      quick_message: quickMessage.statusId
        ? quickMessage.statusId === EWorkerConfigStatus.active
        : defaultConfig.quick_message,
    };

    return this.normalizeSecurityKeyConfig(config, true);
  }

  private normalizeSecurityKeyConfig(
    input: ISecurityKeyConfig,
    allowDisabledEffectiveState = false
  ): ISecurityKeyConfig {
    const scopeKeys: TSecurityKeyScope[] = [
      'chatbot',
      'schedule',
      'quick_message',
    ];
    const hasActiveScope = scopeKeys.some((scope) => input[scope]);

    if (input.enabled && !hasActiveScope && !allowDisabledEffectiveState) {
      throw new Error('security_key_requires_active_option');
    }

    return {
      enabled: input.enabled && hasActiveScope,
      chatbot: input.chatbot,
      schedule: input.schedule,
      quick_message: input.quick_message,
    };
  }

  async updateTypingSimulation(
    workerId: string,
    speed: number,
    enabled: boolean
  ): Promise<ITypingSimulationConfig> {
    if (!isValidTypingSimulationSpeed(speed)) {
      throw new Error('typing_simulation_invalid_speed');
    }

    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const result =
      await this.workerConfigUpserterRepository.updateTypingSimulation(
        workerId,
        speed,
        statusId
      );

    const response = {
      enabled,
      speed: normalizeTypingSimulationSpeed(result),
    };

    await Promise.all([
      this.invalidateWorkerConfigCache(workerId),
      this.cacheTypingSimulationConfig(workerId, response),
    ]);

    return response;
  }

  async viewTypingSimulation(
    workerId: string
  ): Promise<ITypingSimulationConfig> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.typing_simulation
      );

    if (!config.statusId) {
      return defaultTypingSimulationConfig();
    }

    return {
      enabled: config.statusId !== EWorkerConfigStatus.inactive,
      speed: normalizeTypingSimulationSpeed(config.value),
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

  async viewAiAgent(workerId: string): Promise<{
    ai_agent_id: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchAiAgentValue(workerId);

    const aiAgentId = config.aiAgentId || null;

    const enabled =
      config.statusId === EWorkerConfigStatus.active &&
      aiAgentId !== null &&
      aiAgentId.trim().length > 0;

    return {
      ai_agent_id: aiAgentId,
      enabled,
    };
  }

  async updateAiAgent(
    workerId: string,
    aiAgentId: string | null,
    enabled: boolean
  ): Promise<{
    ai_agent_id: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewAiAgent(workerId);
    const aiAgentIdToSave =
      aiAgentId !== null ? aiAgentId : currentConfig.ai_agent_id;

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateAiAgent(
        workerId,
        aiAgentIdToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      ai_agent_id: result,
      enabled,
    };
  }

  async updateChatbots(
    workerId: string,
    chatbotId: string | null,
    outputChatbotId: string | null,
    enabled: boolean,
    chatbotWorkingHoursEnabled: boolean,
    chatbotWorkingHoursTimezone: string,
    chatbotWorkingHoursRules: IChatbotWorkingHoursRule[]
  ): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
    chatbot_working_hours_enabled: boolean;
    chatbot_working_hours_timezone: string;
    chatbot_working_hours_rules: IChatbotWorkingHoursRule[];
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const normalizedTimezone = normalizeChatbotWorkingHoursTimezone(
      chatbotWorkingHoursTimezone || CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE
    );

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateChatbots(
        workerId,
        chatbotId,
        outputChatbotId,
        statusId,
        {
          enabled: chatbotWorkingHoursEnabled,
          timezone: normalizedTimezone,
          rules: chatbotWorkingHoursRules,
        }
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      chatbot_id: result.chatbot_id,
      output_chatbot_id: result.output_chatbot_id,
      chatbot_working_hours_enabled: chatbotWorkingHoursEnabled,
      chatbot_working_hours_timezone: normalizedTimezone,
      chatbot_working_hours_rules: chatbotWorkingHoursRules,
      enabled,
    };
  }

  async viewChatbots(workerId: string): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
    chatbot_working_hours_enabled: boolean;
    chatbot_working_hours_timezone: string;
    chatbot_working_hours_rules: IChatbotWorkingHoursRule[];
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchChatbotsValue(workerId);

    const chatbotId = config.inputChatbotId || null;
    const outputChatbotId = config.outputChatbotId || null;

    const enabled = config.statusId === EWorkerConfigStatus.active;

    return {
      chatbot_id: chatbotId,
      output_chatbot_id: outputChatbotId,
      chatbot_working_hours_enabled: config.chatbotWorkingHoursEnabled,
      chatbot_working_hours_timezone: config.chatbotWorkingHoursTimezone,
      chatbot_working_hours_rules: config.chatbotWorkingHoursRules,
      enabled,
    };
  }

  async updateAttendanceHours(
    workerId: string,
    attendanceHours: IAttendanceHoursConfig,
    text: string | null,
    enabled: boolean
  ): Promise<{
    attendance_hours: IAttendanceHoursConfig;
    outside_hours_message: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;

    const currentConfig = await this.viewAttendanceHours(workerId);
    const textToSave =
      text !== null ? text : currentConfig.outside_hours_message;
    const attendanceHoursToSave = JSON.stringify(attendanceHours);

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateAttendanceHours(
        workerId,
        attendanceHoursToSave,
        textToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return {
      attendance_hours: parseAttendanceHoursConfig(result.attendance_hours),
      outside_hours_message: result.outside_hours_message || null,
      enabled,
    };
  }

  async viewAttendanceHours(workerId: string): Promise<{
    attendance_hours: IAttendanceHoursConfig;
    outside_hours_message: string | null;
    enabled: boolean;
  }> {
    const [attendanceHoursConfig, outsideHoursMessageConfig] =
      await Promise.all([
        this.workerConfigViewerRepository.fetchConfigValueByType(
          workerId,
          EWorkerConfigType.attendance_hours
        ),
        this.workerConfigViewerRepository.fetchConfigValueByType(
          workerId,
          EWorkerConfigType.outside_hours_message
        ),
      ]);

    const enabled =
      attendanceHoursConfig.statusId === EWorkerConfigStatus.active;

    return {
      attendance_hours: parseAttendanceHoursConfig(attendanceHoursConfig.value),
      outside_hours_message: outsideHoursMessageConfig.value || null,
      enabled,
    };
  }

  async updateAttendanceInactivityAlert(
    workerId: string,
    config: IAttendanceInactivityAlertConfig,
    enabled: boolean
  ): Promise<{
    quantity: number;
    time: number;
    action: 'finish';
    inactivity_message_enabled: boolean;
    inactivity_message: string | null;
    enabled: boolean;
  }> {
    const statusId = enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;
    const valueToSave = JSON.stringify(config);

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateAttendanceInactivityAlert(
        workerId,
        valueToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    const parsed = parseAttendanceInactivityAlertConfig(result);

    return {
      quantity: parsed.quantity,
      time: parsed.time,
      action: parsed.action,
      inactivity_message_enabled: parsed.inactivity_message_enabled,
      inactivity_message: parsed.inactivity_message,
      enabled,
    };
  }

  async viewAttendanceInactivityAlert(workerId: string): Promise<{
    quantity: number;
    time: number;
    action: 'finish';
    inactivity_message_enabled: boolean;
    inactivity_message: string | null;
    enabled: boolean;
  }> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.attendance_inactivity_alert
      );

    const parsed = parseAttendanceInactivityAlertConfig(config.value);
    const enabled = config.statusId === EWorkerConfigStatus.active;

    return {
      quantity: parsed.quantity,
      time: parsed.time,
      action: parsed.action,
      inactivity_message_enabled: parsed.inactivity_message_enabled,
      inactivity_message: parsed.inactivity_message,
      enabled,
    };
  }

  async updateOperatorReplyPendingAlert(
    workerId: string,
    config: IOperatorReplyPendingAlertConfig
  ): Promise<IOperatorReplyPendingAlertConfig> {
    const statusId = config.enabled
      ? EWorkerConfigStatus.active
      : EWorkerConfigStatus.inactive;
    const valueToSave = JSON.stringify({
      time_minutes: config.time_minutes,
    });

    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateOperatorReplyPendingAlert(
        workerId,
        valueToSave,
        statusId
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return parseOperatorReplyPendingAlertConfig(result, config.enabled);
  }

  async viewOperatorReplyPendingAlert(
    workerId: string
  ): Promise<IOperatorReplyPendingAlertConfig> {
    const config =
      await this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.operator_reply_pending_alert
      );

    const enabled = config.statusId === EWorkerConfigStatus.active;
    return parseOperatorReplyPendingAlertConfig(config.value, enabled);
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

  async refreshTypingSimulationCache(workerId: string): Promise<void> {
    const config = await this.viewTypingSimulation(workerId);
    await this.cacheTypingSimulationConfig(workerId, config);
  }

  private async cacheTypingSimulationConfig(
    workerId: string,
    config: ITypingSimulationConfig
  ): Promise<void> {
    await this.redis.set(
      typingSimulationCacheKey(workerId),
      JSON.stringify(config),
      'EX',
      TYPING_SIMULATION_CACHE_TTL_SECONDS
    );
  }

  private async invalidateWorkerConfigCache(workerId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`worker:${workerId}:config_fields`),
      this.redis.del(`worker:${workerId}:mark_as_read`),
    ]);

    await this.refreshTypingSimulationCache(workerId);
  }
}
