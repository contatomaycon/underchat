import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { PlanAccountService } from '@core/services/planAccount.service';

@injectable()
export class AiAgentCreatorUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly planAccountService: PlanAccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> {
    await this.planAccountService.validateCanCreateAiAgent(t, accountId);

    const createAiAgent = await this.aiAgentService.createAiAgent(
      input,
      accountId
    );

    if (!createAiAgent) {
      throw new Error(t('ai_agent_creation_failed'));
    }

    return createAiAgent;
  }
}
