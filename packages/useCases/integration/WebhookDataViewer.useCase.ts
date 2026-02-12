import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class WebhookDataViewerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(accountId: string, apiKeyId: string): Promise<unknown | null> {
    return this.integrationService.viewWebhookData(accountId, apiKeyId);
  }
}
