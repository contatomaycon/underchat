import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class IntegrationDeleterUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(accountId: string, apiKeyId: string): Promise<boolean> {
    return this.integrationService.deleteIntegration(accountId, apiKeyId);
  }
}
