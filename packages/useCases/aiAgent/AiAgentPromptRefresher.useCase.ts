import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

@injectable()
export class AiAgentPromptRefresherUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> {
    const aiAgentPrompt = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPrompt) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    if (aiAgentPrompt.status !== EAiAgentStatus.active) {
      await this.embeddingService.deletePromptEmbeddings(aiAgentPromptId);
      if (aiAgentPrompt.openai_file_id) {
        await this.cleanupPromptOpenAIFile(
          aiAgentPrompt.ai_agent_id,
          accountId,
          aiAgentPrompt.openai_file_id
        );
        await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
          aiAgentPromptId,
          accountId,
          null
        );
      }
      return true;
    }

    const agent = await this.aiAgentService.viewAiAgent(
      aiAgentPrompt.ai_agent_id,
      accountId
    );
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;

    if (isGpt && agent?.api_key && agent?.base_url) {
      const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
        aiAgentPrompt.ai_agent_id,
        accountId,
        agent.api_key,
        agent.base_url
      );

      if (agent.model) {
        const instructions =
          this.openAIAssistantService.getAssistantInstructionsFromSystemPrompt(
            agent.system_prompt
          );
        await this.openAIAssistantService.ensureAssistant(
          aiAgentPrompt.ai_agent_id,
          accountId,
          agent.api_key,
          agent.base_url,
          agent.model,
          instructions,
          vectorStoreId
        );
      }

      if (aiAgentPrompt.openai_file_id) {
        try {
          await this.openAIAssistantService.cleanupOpenAIFile(
            agent.api_key,
            agent.base_url,
            vectorStoreId,
            aiAgentPrompt.openai_file_id
          );
        } catch (error) {
          console.error('Erro ao limpar arquivo OpenAI no refresh:', error);
        }
      }
    }

    await this.sendToEmbeddingQueue(
      accountId,
      aiAgentPrompt.ai_agent_id,
      aiAgentPromptId,
      aiAgentPrompt.value,
      'refresh'
    );

    return true;
  }

  private async sendToEmbeddingQueue(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    value: string,
    source: IAiAgentPromptEmbeddingRequest['source']
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      value,
      source,
      retry_count: 0,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }

  private async cleanupPromptOpenAIFile(
    aiAgentId: string,
    accountId: string,
    fileId: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    if (
      !agent ||
      agent.ai_agent_type_id !== EAiAgentType.gpt ||
      !agent.api_key ||
      !agent.base_url
    ) {
      return;
    }

    try {
      await this.openAIAssistantService.cleanupOpenAIFile(
        agent.api_key,
        agent.base_url,
        agent.openai_vector_store_id,
        fileId
      );
    } catch (error) {
      console.error('Erro ao limpar arquivo OpenAI no refresh:', error);
    }
  }
}
