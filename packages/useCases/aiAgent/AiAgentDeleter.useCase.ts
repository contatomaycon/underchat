import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { EmbeddingService } from '@core/services/embedding.service';

@injectable()
export class AiAgentDeleterUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> {
    return this.embeddingService.withEmbeddingGenerationLock(
      accountId,
      aiAgentId,
      () => this.executeWithEmbeddingGenerationLock(t, aiAgentId, accountId)
    );
  }

  private async executeWithEmbeddingGenerationLock(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> {
    const aiAgentExists = await this.aiAgentService.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgentExists) {
      throw new Error(t('ai_agent_not_found'));
    }

    await this.aiAgentService.deleteAiAgentPromptsByAgentId(
      aiAgentId,
      accountId
    );

    await this.embeddingService.deleteAgentEmbeddings(accountId, aiAgentId);

    const aiAgentDeleted = await this.aiAgentService.deleteAiAgentById(
      aiAgentId,
      accountId
    );

    if (!aiAgentDeleted) {
      throw new Error(t('ai_agent_deleter_error'));
    }

    return true;
  }
}
