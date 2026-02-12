import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class IntegrationKeyGeneratorUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(accountId: string, apiKeyId: string): Promise<string | null> {
    return this.integrationService.generateNewKey(accountId, apiKeyId);
  }
}
