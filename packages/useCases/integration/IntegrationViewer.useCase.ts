import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { IntegrationService } from '@core/services/integration.service';
import { ViewIntegrationResponse } from '@core/schema/integration/viewIntegration/response.schema';

@injectable()
export class IntegrationViewerUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ViewIntegrationResponse | null> {
    const integration =
      await this.integrationService.viewIntegration(accountId);

    if (!integration) {
      throw new Error(t('integration_not_found'));
    }

    return integration;
  }
}
