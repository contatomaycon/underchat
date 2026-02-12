import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListIntegrationInputChatbotsResponse } from '@core/schema/integration/listInputChatbots/response.schema';

@injectable()
export class IntegrationInputChatbotsListerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    accountId: string
  ): Promise<ListIntegrationInputChatbotsResponse> {
    return this.integrationService.listInputChatbotsForWebhook(accountId);
  }
}
