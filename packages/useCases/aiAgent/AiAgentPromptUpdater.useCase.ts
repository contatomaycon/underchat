import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';

@injectable()
export class AiAgentPromptUpdaterUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    body: UpdateAiAgentPromptRequest,
    accountId: string
  ): Promise<boolean> {
    const aiAgentPromptExists = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPromptExists) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    const aiAgentPromptUpdater =
      await this.aiAgentService.updateAiAgentPromptById(
        body,
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptUpdater) {
      throw new Error(t('ai_agent_prompt_update_error'));
    }

    return aiAgentPromptUpdater;
  }
}
