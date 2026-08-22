import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';

@injectable()
export class AiAgentPromptRefresherAllUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
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
    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    for (const prompt of prompts) {
      const payload: IAiAgentPromptEmbeddingRequest = {
        account_id: accountId,
        ai_agent_id: aiAgentId,
        ai_agent_prompt_id: prompt.ai_agent_prompt_id,
        ai_agent_type_id: agent?.ai_agent_type_id,
        value: prompt.value,
        source: 'refresh_all',
        retry_count: 0,
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
