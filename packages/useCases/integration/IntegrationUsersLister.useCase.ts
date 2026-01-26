import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListIntegrationUsersResponse } from '@core/schema/integration/listUsers/response.schema';

@injectable()
export class IntegrationUsersListerUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(accountId: string): Promise<ListIntegrationUsersResponse> {
    return this.integrationService.listUsersForWebhook(accountId);
  }
}
