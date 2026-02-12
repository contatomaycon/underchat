import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class IntegrationDeleterUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(accountId: string, apiKeyId: string): Promise<boolean> {
    return this.integrationService.deleteIntegration(accountId, apiKeyId);
  }
}
