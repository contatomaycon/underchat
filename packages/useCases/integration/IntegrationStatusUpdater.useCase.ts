import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationStatusUpdaterUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    accountId: string,
    apiKeyId: string,
    status: EStatusApiKey
  ): Promise<boolean> {
    return this.integrationService.updateIntegrationStatus(
      accountId,
      apiKeyId,
      status
    );
  }
}
