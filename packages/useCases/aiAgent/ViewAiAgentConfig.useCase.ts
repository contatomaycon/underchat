import { injectable } from 'tsyringe';
import { PlanAccountService } from '@core/services/planAccount.service';
import { ViewAiAgentConfigResponse } from '@core/schema/aiAgent/viewAiAgentConfig/response.schema';

@injectable()
export class ViewAiAgentConfigUseCase {
  constructor(private readonly planAccountService: PlanAccountService) {}

  async execute(accountId: string): Promise<ViewAiAgentConfigResponse> {
    const response =
      await this.planAccountService.viewAiAgentConfigByAccountId(accountId);

    return response;
  }
}
