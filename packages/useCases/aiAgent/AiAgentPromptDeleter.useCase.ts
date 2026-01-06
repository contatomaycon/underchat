import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';

@injectable()
export class AiAgentPromptDeleterUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> {
    const aiAgentPromptExists = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPromptExists) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    const aiAgentPromptDeleted =
      await this.aiAgentService.deleteAiAgentPromptById(
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptDeleted) {
      throw new Error(t('ai_agent_prompt_deleter_error'));
    }

    return true;
  }
}
