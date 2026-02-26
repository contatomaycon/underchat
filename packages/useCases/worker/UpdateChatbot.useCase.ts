import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { ChatbotService } from '@core/services/chatbot.service';
import { UpdateChatbotRequest } from '@core/schema/worker/updateChatbot/request.schema';
import {
  CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE,
  findConflictingChatbotWorkingHoursRules,
  isChatbotWorkingHoursRuleWindowValid,
} from '@core/common/functions/chatbotWorkingHours';
import { IChatbotWorkingHoursRule } from '@core/common/interfaces/IChatbotWorkingHours';

@injectable()
export class UpdateChatbotUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateChatbotRequest
  ): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
    chatbot_working_hours_enabled: boolean;
    chatbot_working_hours_timezone: string;
    chatbot_working_hours_rules: IChatbotWorkingHoursRule[];
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const chatbots = await this.chatbotService.listChatbots(accountId);
    const currentConfig = await this.workerConfigService.viewChatbots(workerId);

    const chatbotIdToSave =
      body.chatbot_id === undefined
        ? currentConfig.chatbot_id
        : body.chatbot_id?.trim() || null;

    const outputChatbotIdToSave =
      body.output_chatbot_id === undefined
        ? currentConfig.output_chatbot_id
        : body.output_chatbot_id?.trim() || null;
    const enabledToSave =
      body.enabled === undefined ? currentConfig.enabled : body.enabled;
    const chatbotWorkingHoursEnabledToSave =
      body.chatbot_working_hours_enabled === undefined
        ? currentConfig.chatbot_working_hours_enabled
        : body.chatbot_working_hours_enabled;
    const chatbotWorkingHoursTimezoneToSave =
      CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE;
    const chatbotWorkingHoursRulesToSave = (
      body.chatbot_working_hours_rules === undefined
        ? currentConfig.chatbot_working_hours_rules
        : body.chatbot_working_hours_rules
    ).map((rule) => ({
      weekday: rule.weekday,
      start_time: rule.start_time.trim(),
      end_time: rule.end_time.trim(),
      chatbot_id: rule.chatbot_id.trim(),
    }));

    if (chatbotIdToSave) {
      const chatbotExists = chatbots.some(
        (c) => c.chatbot_id === chatbotIdToSave && c.type === 'input'
      );

      if (!chatbotExists) {
        throw new Error(t('chatbot_not_found'));
      }
    }

    if (outputChatbotIdToSave) {
      const chatbotExists = chatbots.some(
        (c) => c.chatbot_id === outputChatbotIdToSave && c.type === 'output'
      );

      if (!chatbotExists) {
        throw new Error(t('chatbot_not_found'));
      }
    }

    for (const rule of chatbotWorkingHoursRulesToSave) {
      if (!isChatbotWorkingHoursRuleWindowValid(rule)) {
        throw new Error(
          t('chatbot_working_hours_invalid_time_range', {
            day: t(rule.weekday),
          })
        );
      }

      const chatbotExists = chatbots.some(
        (c) => c.chatbot_id === rule.chatbot_id && c.type === 'input'
      );

      if (!chatbotExists) {
        throw new Error(t('chatbot_not_found'));
      }
    }

    const conflict = findConflictingChatbotWorkingHoursRules(
      chatbotWorkingHoursRulesToSave
    );
    if (conflict) {
      throw new Error(
        t('chatbot_working_hours_rule_conflict', {
          day: t(conflict.first.weekday),
        })
      );
    }

    const result = await this.workerConfigService.updateChatbots(
      workerId,
      chatbotIdToSave,
      outputChatbotIdToSave,
      enabledToSave,
      chatbotWorkingHoursEnabledToSave,
      chatbotWorkingHoursTimezoneToSave,
      chatbotWorkingHoursRulesToSave
    );

    return {
      chatbot_id: result.chatbot_id,
      output_chatbot_id: result.output_chatbot_id,
      chatbot_working_hours_enabled: result.chatbot_working_hours_enabled,
      chatbot_working_hours_timezone: result.chatbot_working_hours_timezone,
      chatbot_working_hours_rules: result.chatbot_working_hours_rules,
      enabled: result.enabled,
    };
  }
}
