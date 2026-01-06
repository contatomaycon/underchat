import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ViewAiAgentPromptResponse } from '@core/schema/aiAgent/viewAiAgentPrompt/response.schema';

@injectable()
export class AiAgentPromptViewerUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    accountId: string
  ): Promise<ViewAiAgentPromptResponse | null> {
    const aiAgentPrompt = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPrompt) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    return aiAgentPrompt;
  }
}
