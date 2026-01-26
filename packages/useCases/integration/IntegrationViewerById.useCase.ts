import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ViewIntegrationByIdResponse } from '@core/schema/integration/viewIntegrationById/response.schema';

@injectable()
export class IntegrationViewerByIdUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    accountId: string,
    apiKeyId: string
  ): Promise<ViewIntegrationByIdResponse | null> {
    return this.integrationService.viewIntegrationById(accountId, apiKeyId);
  }
}
