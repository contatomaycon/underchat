import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { PlanAccountService } from '@core/services/planAccount.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class AiAgentCreatorUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService
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
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> {
    await this.planAccountService.validateCanCreateAiAgent(t, accountId);

    const createAiAgent = await this.aiAgentService.createAiAgent(
      input,
      accountId
    );

    if (!createAiAgent) {
      throw new Error(t('ai_agent_creation_failed'));
    }

    await this.ensureOpenAIIfNeeded(accountId, createAiAgent);

    return createAiAgent;
  }
}
