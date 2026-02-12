import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';
import { ListIntegrationsResponse } from '@core/schema/integration/listIntegrations/response.schema';

@injectable()
export class IntegrationListerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    accountId: string,
    request: ListIntegrationsRequest
  ): Promise<ListIntegrationsResponse> {
    return this.integrationService.listIntegrations(accountId, request);
  }
}
