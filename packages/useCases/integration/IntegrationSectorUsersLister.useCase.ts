import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListIntegrationSectorUsersResponse } from '@core/schema/integration/listSectorUsers/response.schema';

@injectable()
export class IntegrationSectorUsersListerUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    accountId: string,
    sectorId: string
  ): Promise<ListIntegrationSectorUsersResponse> {
    return this.integrationService.listSectorUsersForWebhook(
      accountId,
      sectorId
    );
  }
}
