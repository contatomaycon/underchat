import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class WebhookMappingViewerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    accountId: string,
    apiKeyId: string
  ): Promise<{
    account_id: string;
    worker_id: string | null;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at?: string;
  } | null> {
    return this.integrationService.viewWebhookMapping(accountId, apiKeyId);
  }
}
