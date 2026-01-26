import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class WebhookMappingSaverUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    apiKeyId: string,
    mapping: Record<string, string | string[]>
  ): Promise<boolean> {
    const success = await this.integrationService.saveWebhookMapping(
      accountId,
      apiKeyId,
      mapping
    );

    if (!success) {
      throw new Error(t('webhook_mapping_save_error'));
    }

    return success;
  }
}
