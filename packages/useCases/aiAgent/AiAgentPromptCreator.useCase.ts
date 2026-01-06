import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';

@injectable()
export class AiAgentPromptCreatorUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAiAgentPromptRequest,
    accountId: string
  ): Promise<string | null> {
    const createAiAgentPrompt = await this.aiAgentService.createAiAgentPrompt(
      input,
      accountId
    );

    if (!createAiAgentPrompt) {
      throw new Error(t('ai_agent_prompt_creation_failed'));
    }

    return createAiAgentPrompt;
  }
}
