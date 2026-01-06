import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';

@injectable()
export class AiAgentUpdaterUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
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

    const aiAgentUpdater = await this.aiAgentService.updateAiAgentById(
      body,
      aiAgentId,
      accountId
    );

    if (!aiAgentUpdater) {
      throw new Error(t('ai_agent_update_error'));
    }

    return aiAgentUpdater;
  }
}
