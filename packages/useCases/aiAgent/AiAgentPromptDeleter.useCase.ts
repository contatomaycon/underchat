import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { StorageService } from '@core/services/storage.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';

@injectable()
export class AiAgentPromptDeleterUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly storageService: StorageService,
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

    if (aiAgentPromptExists.ai_agent_prompt_type === EAiAgentPromptType.file) {
      await this.deleteFileFromS3(aiAgentPromptExists.value);
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
}
