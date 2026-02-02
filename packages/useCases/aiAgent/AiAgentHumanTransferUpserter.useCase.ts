import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { UpsertAiAgentHumanTransferBody } from '@core/schema/aiAgent/upsertAiAgentHumanTransfer/request.schema';

@injectable()
export class AiAgentHumanTransferUpserterUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    body: UpsertAiAgentHumanTransferBody,
    accountId: string
  ): Promise<boolean> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    if (!agent) {
      throw new Error(t('ai_agent_not_found'));
    }

    return this.aiAgentService.upsertAiAgentHumanTransfer(
      aiAgentId,
      accountId,
      body
    );
  }
}
