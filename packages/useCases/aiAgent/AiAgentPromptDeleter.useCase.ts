import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

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
    const aiAgentPromptExists = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPromptExists) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    await this.deleteFileFromS3(aiAgentPromptExists.value);

    if (aiAgentPromptExists.openai_file_id) {
      await this.cleanupOpenAIFileIfNeeded(
        aiAgentPromptExists.ai_agent_id,
        accountId,
        aiAgentPromptExists.openai_file_id
      );
    }

    const aiAgentPromptDeleted =
      await this.aiAgentService.deleteAiAgentPromptById(
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptDeleted) {
      throw new Error(t('ai_agent_prompt_deleter_error'));
    }

    await this.embeddingService.deletePromptEmbeddings(aiAgentPromptId);

    return true;
  }

  private async cleanupOpenAIFileIfNeeded(
    aiAgentId: string,
    accountId: string,
    openaiFileId: string
  ): Promise<void> {
    try {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      if (
        !agent ||
        agent.ai_agent_type_id !== EAiAgentType.gpt ||
        !agent.api_key ||
        !agent.base_url
      ) {
        return;
      }

      await this.openAIAssistantService.cleanupOpenAIFile(
        agent.api_key,
        agent.base_url,
        agent.openai_vector_store_id,
        openaiFileId
      );
    } catch (error) {
      console.error('Erro ao limpar arquivo OpenAI na exclusão:', error);
    }
  }
}
