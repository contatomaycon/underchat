import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';

@injectable()
export class IntegrationUpdaterUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    accountId: string,
    apiKeyId: string,
    request: UpdateIntegrationRequest
  ): Promise<boolean> {
    return this.integrationService.updateIntegration(
      accountId,
      apiKeyId,
      request
    );
  }
}
