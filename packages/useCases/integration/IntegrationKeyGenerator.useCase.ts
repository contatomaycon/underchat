import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class IntegrationKeyGeneratorUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<string> {
    const key = await this.integrationService.generateNewKey(accountId);

    if (!key) {
      throw new Error(t('integration_key_generation_error'));
    }

    return key;
  }
}
