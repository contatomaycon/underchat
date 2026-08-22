import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';
import { prepareAiAgentProviderConfiguration } from '@core/services/aiAgentProviderConfiguration.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { AiAgentPromptRefresherAllUseCase } from './AiAgentPromptRefresherAll.useCase';

interface EnsuredOpenAIVectorStore {
  apiKey: string;
  baseUrl: string;
  vectorStoreId: string;
}

@injectable()
export class AiAgentUpdaterUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(PlanLimitEnforcementService)
    private readonly planLimitEnforcementService: PlanLimitEnforcementService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @inject(AiAgentPromptRefresherAllUseCase)
    private readonly aiAgentPromptRefresherAllUseCase: AiAgentPromptRefresherAllUseCase
  ) {}

  private async refreshAllPromptsWithRetry(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.aiAgentPromptRefresherAllUseCase.execute(
          t,
          aiAgentId,
          accountId
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, attempt * 250);
          });
        }
      }
    }

    throw lastError;
  }

  private async ensureOpenAIIfNeeded(
    accountId: string,
    aiAgentId: string
  ): Promise<EnsuredOpenAIVectorStore | null> {
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

  private async cleanupReplacementVectorStore(
    resource: EnsuredOpenAIVectorStore
  ): Promise<void> {
    await this.openAIAssistantService.deleteVectorStore(
      resource.apiKey,
      resource.baseUrl,
      resource.vectorStoreId
    );
  }

  private async rollbackAiAgentUpdate(
    rollbackBody: UpdateAiAgentRequest,
    aiAgentId: string,
    accountId: string,
    vectorStoreRollbackId: string | null
  ): Promise<void> {
    try {
      const rollbackSucceeded = await this.aiAgentService.updateAiAgentById(
        rollbackBody,
        aiAgentId,
        accountId
      );

      if (!rollbackSucceeded) {
        throw new Error('AI Agent rollback update returned false.');
      }
      const vectorStoreRollbackSucceeded =
        await this.aiAgentService.updateAiAgentOpenAIIds(aiAgentId, accountId, {
          openai_vector_store_id: vectorStoreRollbackId,
        });
      if (!vectorStoreRollbackSucceeded) {
        throw new Error('AI Agent vector-store rollback returned false.');
      }
    } catch (rollbackError) {
      console.error('[AiAgentUpdater] failed to rollback agent update', {
        ai_agent_id: aiAgentId,
        account_id: accountId,
        rollback_error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
      throw rollbackError;
    }
  }

  private async rollbackFailedActiveUpdate(input: {
    error: unknown;
    rollbackBody: UpdateAiAgentRequest;
    aiAgentId: string;
    accountId: string;
    previousVectorStoreId: string | null;
    ensuredVectorStore: EnsuredOpenAIVectorStore | null;
    providerConnectionChanged: boolean;
  }): Promise<never> {
    const vectorStoreChanged =
      input.ensuredVectorStore !== null &&
      input.ensuredVectorStore.vectorStoreId !== input.previousVectorStoreId;
    const vectorStoreRollbackId =
      vectorStoreChanged && !input.providerConnectionChanged
        ? null
        : input.previousVectorStoreId;

    try {
      await this.rollbackAiAgentUpdate(
        input.rollbackBody,
        input.aiAgentId,
        input.accountId,
        vectorStoreRollbackId
      );
    } catch (rollbackError) {
      throw new AggregateError(
        [input.error, rollbackError],
        'AI Agent update and rollback both failed.'
      );
    }

    if (vectorStoreChanged && input.ensuredVectorStore) {
      try {
        await this.cleanupReplacementVectorStore(input.ensuredVectorStore);
      } catch (cleanupError) {
        throw new AggregateError(
          [input.error, cleanupError],
          'AI Agent update failed and replacement vector-store cleanup failed.'
        );
      }
    }

    throw input.error;
  }

  private didVectorStoreChange(
    previousVectorStoreId: string | null,
    ensuredVectorStore: EnsuredOpenAIVectorStore | null
  ): boolean {
    return (
      ensuredVectorStore !== null &&
      ensuredVectorStore.vectorStoreId !== previousVectorStoreId
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    body: UpdateAiAgentRequest,
    accountId: string
  ): Promise<boolean> {
    return this.embeddingService.withEmbeddingGenerationLock(
      accountId,
      aiAgentId,
      () =>
        this.executeWithEmbeddingGenerationLock(t, aiAgentId, body, accountId)
    );
  }

  private async executeWithEmbeddingGenerationLock(
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

    const effectiveStatus =
      body.status ?? aiAgentExists.status ?? EAiAgentStatus.active;
    const providerConfiguration = await prepareAiAgentProviderConfiguration({
      ai_agent_type_id: aiAgentExists.ai_agent_type_id,
      base_url:
        body.base_url === undefined ? aiAgentExists.base_url : body.base_url,
      api_key:
        body.api_key === undefined ? aiAgentExists.api_key : body.api_key,
      model: body.model === undefined ? aiAgentExists.model : body.model,
      embedding_model:
        body.embedding_model === undefined
          ? aiAgentExists.embedding_model
          : body.embedding_model,
      status: effectiveStatus,
    });

    if (body.status === EAiAgentStatus.active) {
      await this.planLimitEnforcementService.ensureCanActivateAiAgentIfNeeded(
        t,
        accountId,
        aiAgentId
      );
    }

    const normalizedBody: UpdateAiAgentRequest = {
      ...body,
      ...providerConfiguration,
    };
    const effectiveChunkSize = body.chunk_size ?? aiAgentExists.chunk_size;
    const effectiveChunkOverlap =
      body.chunk_overlap ?? aiAgentExists.chunk_overlap;
    const embeddingGenerationChanged =
      providerConfiguration.base_url !== aiAgentExists.base_url ||
      providerConfiguration.embedding_model !== aiAgentExists.embedding_model ||
      effectiveChunkSize !== aiAgentExists.chunk_size ||
      effectiveChunkOverlap !== aiAgentExists.chunk_overlap;
    const embeddingVectorIdentityChanged =
      providerConfiguration.base_url !== aiAgentExists.base_url ||
      providerConfiguration.embedding_model !== aiAgentExists.embedding_model;
    const gptCredentialChanged =
      aiAgentExists.ai_agent_type_id === EAiAgentType.gpt &&
      providerConfiguration.api_key !== aiAgentExists.api_key;
    const gptProviderConnectionChanged =
      aiAgentExists.ai_agent_type_id === EAiAgentType.gpt &&
      (gptCredentialChanged ||
        providerConfiguration.base_url !== aiAgentExists.base_url);

    const aiAgentUpdater = await this.aiAgentService.updateAiAgentById(
      normalizedBody,
      aiAgentId,
      accountId
    );

    if (!aiAgentUpdater) {
      throw new Error(t('ai_agent_update_error'));
    }

    if (effectiveStatus === EAiAgentStatus.inactive) {
      return aiAgentUpdater;
    }

    const rollbackBody: UpdateAiAgentRequest = {
      name: aiAgentExists.name,
      base_url: aiAgentExists.base_url,
      api_key: aiAgentExists.api_key,
      model: aiAgentExists.model,
      embedding_model: aiAgentExists.embedding_model,
      chunk_size: aiAgentExists.chunk_size,
      chunk_overlap: aiAgentExists.chunk_overlap,
      status: aiAgentExists.status,
      system_prompt: aiAgentExists.system_prompt,
      enable_human_transfer: aiAgentExists.enable_human_transfer,
      voice_ia_id: aiAgentExists.voice_ia_id,
      voice_ia_input_mode: aiAgentExists.voice_ia_input_mode,
      voice_ia_output_mode: aiAgentExists.voice_ia_output_mode,
    };

    let ensuredVectorStore: EnsuredOpenAIVectorStore | null = null;
    try {
      ensuredVectorStore = await this.ensureOpenAIIfNeeded(
        accountId,
        aiAgentId
      );
      const vectorStoreChanged = this.didVectorStoreChange(
        aiAgentExists.openai_vector_store_id,
        ensuredVectorStore
      );

      const prompts = await this.aiAgentService.listAiAgentPrompts(
        { ai_agent_id: aiAgentId },
        accountId
      );
      const activePromptIds = prompts
        .filter((prompt) => prompt.status === EAiAgentStatus.active)
        .map((prompt) => prompt.ai_agent_prompt_id);
      const generationIsComplete =
        !embeddingGenerationChanged &&
        !gptCredentialChanged &&
        !vectorStoreChanged &&
        (await this.embeddingService.hasCompletePromptEmbeddingGeneration(
          accountId,
          aiAgentId,
          activePromptIds
        ));
      const shouldRefreshKnowledge =
        prompts.length > 0 &&
        (embeddingGenerationChanged ||
          gptCredentialChanged ||
          vectorStoreChanged ||
          !generationIsComplete);

      if (shouldRefreshKnowledge) {
        await this.refreshAllPromptsWithRetry(t, aiAgentId, accountId);
      }

      const becameActive =
        aiAgentExists.status === EAiAgentStatus.inactive &&
        effectiveStatus === EAiAgentStatus.active;
      if (embeddingVectorIdentityChanged || becameActive) {
        await this.embeddingService.invalidateChatHistoryEmbeddingGeneration(
          accountId,
          aiAgentId
        );
      }
    } catch (error) {
      await this.rollbackFailedActiveUpdate({
        error,
        rollbackBody,
        aiAgentId,
        accountId,
        previousVectorStoreId: aiAgentExists.openai_vector_store_id,
        ensuredVectorStore,
        providerConnectionChanged: gptProviderConnectionChanged,
      });
    }

    return aiAgentUpdater;
  }
}
