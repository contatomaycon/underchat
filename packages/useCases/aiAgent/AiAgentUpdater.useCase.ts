import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class AiAgentUpdaterUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly openAIAssistantService: OpenAIAssistantService
  ) {}

  private async ensureOpenAIIfNeeded(
    accountId: string,
    aiAgentId: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;
    if (!isGpt || !agent?.api_key || !agent?.base_url || !agent?.model) {
      return;
    }

    const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
      aiAgentId,
      accountId,
      agent.api_key,
      agent.base_url
    );

    const instructions =
      this.openAIAssistantService.getAssistantInstructionsFromSystemPrompt(
        agent.system_prompt
      );
    await this.openAIAssistantService.ensureAssistant(
      aiAgentId,
      accountId,
      agent.api_key,
      agent.base_url,
      agent.model,
      instructions,
      vectorStoreId
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    body: UpdateAiAgentRequest,
    accountId: string
  ): Promise<boolean> {
    const aiAgentExists = await this.aiAgentService.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgentExists) {
      throw new Error(t('ai_agent_not_found'));
    }

    const aiAgentUpdater = await this.aiAgentService.updateAiAgentById(
      body,
      aiAgentId,
      accountId
    );

    if (!aiAgentUpdater) {
      throw new Error(t('ai_agent_update_error'));
    }

    await this.ensureOpenAIIfNeeded(accountId, aiAgentId);

    return aiAgentUpdater;
  }
}
