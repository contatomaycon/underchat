import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';

@injectable()
export class AiAgentViewerUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<ViewAiAgentResponse | null> {
    const viewAiAgent = await this.aiAgentService.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!viewAiAgent) {
      throw new Error(t('ai_agent_not_found'));
    }

    return viewAiAgent;
  }
}
