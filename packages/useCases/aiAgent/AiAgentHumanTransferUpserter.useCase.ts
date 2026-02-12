import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { UpsertAiAgentHumanTransferBody } from '@core/schema/aiAgent/upsertAiAgentHumanTransfer/request.schema';

@injectable()
export class AiAgentHumanTransferUpserterUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentId: string,
    body: UpsertAiAgentHumanTransferBody,
    accountId: string
  ): Promise<boolean> {
    if (body.enable_human_transfer && body.enable_human_transfer_by_prompt) {
      throw new Error(t('ai_agent_human_transfer_only_one_enabled_allowed'));
    }
    if (body.enable_human_transfer && body.sector_targets.length === 0) {
      throw new Error(t('ai_agent_human_transfer_sector_required'));
    }

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
