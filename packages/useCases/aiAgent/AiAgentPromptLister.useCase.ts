import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ListAiAgentPromptRequest } from '@core/schema/aiAgent/listAiAgentPrompt/request.schema';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';

@injectable()
export class AiAgentPromptListerUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListAiAgentPromptRequest,
    accountId: string
  ): Promise<ListAiAgentPromptResponse[]> {
    const result = await this.aiAgentService.listAiAgentPrompts(
      query,
      accountId
    );

    return result;
  }
}
