import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { PlanAccountService } from '@core/services/planAccount.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { prepareAiAgentProviderConfiguration } from '@core/services/aiAgentProviderConfiguration.service';

interface ProvisionedOpenAIResource {
  apiKey: string;
  baseUrl: string;
  vectorStoreId: string;
}

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
  ): Promise<ProvisionedOpenAIResource | null> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;
    if (
      !isGpt ||
      agent?.status !== EAiAgentStatus.active ||
      !agent.api_key ||
      !agent.base_url
    ) {
      return null;
    }

    const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
      aiAgentId,
      accountId,
      agent.api_key,
      agent.base_url
    );

    return {
      apiKey: agent.api_key,
      baseUrl: agent.base_url,
      vectorStoreId,
    };
  }

  private async assertVectorStoreWasPersisted(
    aiAgentId: string,
    accountId: string,
    resource: ProvisionedOpenAIResource
  ): Promise<void> {
    const persistedAgent = await this.aiAgentService.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (persistedAgent?.openai_vector_store_id !== resource.vectorStoreId) {
      throw new Error(
        'OpenAI vector store was provisioned but was not persisted.'
      );
    }
  }

  private async deleteCreatedAgentWithRetry(
    aiAgentId: string,
    accountId: string
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        /*
         * A resolved false means the exact row is already absent, which is a
         * successful idempotent compensation after an ambiguous delete.
         */
        await this.aiAgentService.deleteAiAgentById(aiAgentId, accountId);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async rollbackCreatedAgent(
    aiAgentId: string,
    accountId: string,
    resource: ProvisionedOpenAIResource | null
  ): Promise<void> {
    /*
     * Remove the database owner first. If this fails, the vector store must
     * remain available to the still-persisted agent.
     */
    await this.deleteCreatedAgentWithRetry(aiAgentId, accountId);

    if (resource) {
      await this.openAIAssistantService.deleteVectorStore(
        resource.apiKey,
        resource.baseUrl,
        resource.vectorStoreId
      );
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> {
    await this.planAccountService.validateCanCreateAiAgent(t, accountId);

    const providerConfiguration = await prepareAiAgentProviderConfiguration({
      ...input,
      status: input.status ?? EAiAgentStatus.active,
    });
    const normalizedInput: CreateAiAgentRequest = {
      ...input,
      ...providerConfiguration,
      model: providerConfiguration.model ?? undefined,
    };

    const createAiAgent = await this.aiAgentService.createAiAgent(
      normalizedInput,
      accountId
    );

    if (!createAiAgent) {
      throw new Error(t('ai_agent_creation_failed'));
    }

    let provisionedOpenAIResource: ProvisionedOpenAIResource | null = null;
    try {
      provisionedOpenAIResource = await this.ensureOpenAIIfNeeded(
        accountId,
        createAiAgent
      );
      if (provisionedOpenAIResource) {
        await this.assertVectorStoreWasPersisted(
          createAiAgent,
          accountId,
          provisionedOpenAIResource
        );
      }
    } catch (creationError) {
      try {
        await this.rollbackCreatedAgent(
          createAiAgent,
          accountId,
          provisionedOpenAIResource
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [creationError, rollbackError],
          'AI agent creation and compensation both failed.'
        );
      }

      throw creationError;
    }

    return createAiAgent;
  }
}
