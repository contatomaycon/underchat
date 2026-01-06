import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';

@injectable()
export class AiAgentDeleterUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
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
