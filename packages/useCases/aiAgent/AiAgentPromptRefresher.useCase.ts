import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class AiAgentPromptRefresherUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly openAIAssistantService: OpenAIAssistantService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
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

    if (aiAgentPrompt.openai_file_id) {
      await this.cleanupOpenAIFileIfNeeded(
        aiAgentPrompt.ai_agent_id,
        accountId,
        aiAgentPrompt.openai_file_id
      );
    }

    await this.sendToEmbeddingQueue(
      accountId,
      aiAgentPrompt.ai_agent_id,
      aiAgentPromptId,
      aiAgentPrompt.ai_agent_prompt_type,
      aiAgentPrompt.name,
      aiAgentPrompt.value
    );

    return true;
  }

  private async cleanupOpenAIFileIfNeeded(
    aiAgentId: string,
    accountId: string,
    openaiFileId: string
  ): Promise<void> {
    try {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      if (!agent || agent.ai_agent_type_id !== EAiAgentType.gpt || !agent.api_key || !agent.base_url) {
        return;
      }

      await this.openAIAssistantService.cleanupOpenAIFile(
        agent.api_key,
        agent.base_url,
        agent.openai_vector_store_id,
        openaiFileId
      );
    } catch (error) {
      console.error('Erro ao limpar arquivo OpenAI no refresh:', error);
    }
  }

  private async sendToEmbeddingQueue(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    promptType: EAiAgentPromptType,
    name: string,
    value: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      prompt_type: promptType,
      name,
      value,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }
}
