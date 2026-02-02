import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ViewAiAgentHumanTransferResponse } from '@core/schema/aiAgent/viewAiAgentHumanTransfer/response.schema';

@injectable()
export class AiAgentHumanTransferViewerUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string
  ): Promise<ViewAiAgentHumanTransferResponse | null> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    if (!agent) {
      throw new Error(t('ai_agent_not_found'));
    }

    return this.aiAgentService.viewAiAgentHumanTransfer(aiAgentId, accountId);
  }
}
