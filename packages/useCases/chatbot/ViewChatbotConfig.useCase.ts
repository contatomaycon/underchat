import { injectable } from 'tsyringe';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ViewChatbotConfigResponse } from '@core/schema/chatbot/viewChatbotConfig/response.schema';

@injectable()
export class ViewChatbotConfigUseCase {
  constructor(private readonly workerConfigService: WorkerConfigService) {}

  async execute(accountId: string): Promise<ViewChatbotConfigResponse> {
    const response =
      await this.workerConfigService.viewChatbotConfigByAccountId(accountId);

    return response;
  }
}
