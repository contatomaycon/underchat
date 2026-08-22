import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

@injectable()
export class AiAgentPromptDeleterUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService
  ) {}

  private async deleteFileFromS3(
    fileUrl: string | null | undefined
  ): Promise<void> {
    if (!fileUrl) {
      return;
    }

    await this.storageService.deleteImage(fileUrl);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> {
    const prompt = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!prompt) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    return this.embeddingService.withEmbeddingGenerationLock(
      accountId,
      prompt.ai_agent_id,
      () =>
        this.executeWithEmbeddingGenerationLock(t, aiAgentPromptId, accountId)
    );
  }

  private async executeWithEmbeddingGenerationLock(
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

    const gptProvider = aiAgentPromptExists.openai_file_id
      ? await this.stageOpenAIFileCleanupIfNeeded(
          aiAgentPromptExists.ai_agent_id,
          accountId,
          aiAgentPromptId,
          aiAgentPromptExists.openai_file_id
        )
      : null;

    const promptDeactivated = await this.aiAgentService.updateAiAgentPromptById(
      { status: EAiAgentStatus.inactive },
      aiAgentPromptId,
      accountId
    );
    if (!promptDeactivated) {
      throw new Error(t('ai_agent_prompt_deleter_error'));
    }

    const embeddingsDeleted =
      await this.embeddingService.deletePromptEmbeddings(aiAgentPromptId);
    if (!embeddingsDeleted) {
      throw new Error(t('ai_agent_prompt_deleter_error'));
    }

    const aiAgentPromptDeleted =
      await this.aiAgentService.deleteAiAgentPromptById(
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptDeleted) {
      throw new Error(t('ai_agent_prompt_deleter_error'));
    }

    try {
      await this.deleteFileFromS3(aiAgentPromptExists.value);
    } catch (error) {
      console.error(
        '[AiAgentPromptDeleter] prompt deleted but source cleanup failed',
        {
          error,
          ai_agent_prompt_id: aiAgentPromptId,
          account_id: accountId,
        }
      );
    }

    if (gptProvider) {
      try {
        await this.openAIAssistantService.cleanupPendingOpenAIFiles(
          gptProvider.apiKey,
          gptProvider.baseUrl,
          accountId,
          aiAgentPromptExists.ai_agent_id
        );
      } catch (error) {
        console.error(
          '[AiAgentPromptDeleter] deferred OpenAI cleanup remains pending',
          {
            error,
            ai_agent_prompt_id: aiAgentPromptId,
            account_id: accountId,
          }
        );
      }
    }

    return true;
  }

  private async stageOpenAIFileCleanupIfNeeded(
    aiAgentId: string,
    accountId: string,
    aiAgentPromptId: string,
    openaiFileId: string
  ): Promise<{ apiKey: string; baseUrl: string } | null> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    if (!agent || agent.ai_agent_type_id !== EAiAgentType.gpt) {
      return null;
    }

    await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
      accountId,
      aiAgentId,
      aiAgentPromptId,
      agent.openai_vector_store_id,
      openaiFileId
    );

    if (!agent.api_key || !agent.base_url) {
      return null;
    }
    return {
      apiKey: agent.api_key,
      baseUrl: agent.base_url,
    };
  }
}
