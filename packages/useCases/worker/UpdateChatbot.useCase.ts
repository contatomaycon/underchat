import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { ChatbotService } from '@core/services/chatbot.service';
import { UpdateChatbotRequest } from '@core/schema/worker/updateChatbot/request.schema';

@injectable()
export class UpdateChatbotUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService,
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

    if (chatbotIdToSave && body.output_chatbot_id === undefined) {
      const result = await this.workerConfigService.updateChatbot(
        workerId,
        chatbotIdToSave,
        body.enabled
      );

      const currentOutputConfig =
        await this.workerConfigService.viewChatbots(workerId);

      return {
        chatbot_id: result.chatbot_id,
        output_chatbot_id: currentOutputConfig.output_chatbot_id,
        enabled: result.enabled,
      };
    }

    const result = await this.workerConfigService.updateChatbots(
      workerId,
      chatbotIdToSave,
      outputChatbotIdToSave,
      body.enabled
    );

    return {
      chatbot_id: result.chatbot_id,
      output_chatbot_id: result.output_chatbot_id,
      enabled: result.enabled,
    };
  }
}
