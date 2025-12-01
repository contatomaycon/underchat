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
    isAdministrator: boolean,
    workerId: string,
    body: UpdateChatbotRequest
  ): Promise<{ chatbot_id: string | null }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    if (body.chatbot_id) {
      const chatbots = await this.chatbotService.listChatbots(accountId);
      const chatbotExists = chatbots.some(
        (c) => c.chatbot_id === body.chatbot_id
      );

      if (!chatbotExists) {
        throw new Error(t('chatbot_not_found'));
      }
    }

    const chatbotId = body.chatbot_id?.trim() || null;
    const result = await this.workerConfigService.updateChatbot(
      workerId,
      chatbotId
    );

    return {
      chatbot_id: result,
    };
  }
}
