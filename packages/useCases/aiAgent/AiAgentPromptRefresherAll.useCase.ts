import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class AiAgentPromptRefresherAllUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly openAIAssistantService: OpenAIAssistantService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> {
    const prompts = await this.aiAgentService.listAiAgentPrompts(
      { ai_agent_id: aiAgentId },
      accountId
    );

    if (prompts.length === 0) {
      throw new Error(t('ai_agent_prompt_list_empty'));
    }

    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;

    if (isGpt && agent?.api_key && agent?.base_url) {
      const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
        aiAgentId,
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
          aiAgentId,
          accountId,
          agent.api_key,
          agent.base_url,
          agent.model,
          instructions,
          vectorStoreId
        );
      }

      for (const prompt of prompts) {
        if (prompt.openai_file_id) {
          try {
            await this.openAIAssistantService.cleanupOpenAIFile(
              agent.api_key,
              agent.base_url,
              vectorStoreId,
              prompt.openai_file_id
            );
          } catch (error) {
            console.error(
              `Erro ao limpar arquivo OpenAI (prompt ${prompt.ai_agent_prompt_id}):`,
              error
            );
          }
        }
      }
    }

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    for (const prompt of prompts) {
      const payload: IAiAgentPromptEmbeddingRequest = {
        account_id: accountId,
        ai_agent_id: aiAgentId,
        ai_agent_prompt_id: prompt.ai_agent_prompt_id,
        ai_agent_type_id: agent?.ai_agent_type_id,
        value: prompt.value,
      };

      await this.streamProducerService.send(
        topic,
        payload,
        prompt.ai_agent_prompt_id
      );
    }

    return true;
  }
}
