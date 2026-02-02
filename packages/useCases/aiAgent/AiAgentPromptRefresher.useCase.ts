import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
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
      aiAgentPrompt.value
    );

    return true;
  }

  private async sendToEmbeddingQueue(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    value: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      value,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }
}
