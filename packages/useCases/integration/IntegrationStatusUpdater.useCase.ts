import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { IntegrationService } from '@core/services/integration.service';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationStatusUpdaterUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    status: EStatusApiKey
  ): Promise<boolean> {
    const success = await this.integrationService.updateIntegrationStatus(
      accountId,
      status
    );

    if (!success) {
      throw new Error(t('integration_status_update_error'));
    }

    return success;
  }
}
