import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { CreateIntegrationResponse } from '@core/schema/integration/createIntegration/response.schema';

@injectable()
export class IntegrationCreatorUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    accountId: string,
    request: CreateIntegrationRequest
  ): Promise<CreateIntegrationResponse | null> {
    return this.integrationService.createIntegration(accountId, request);
  }
}
