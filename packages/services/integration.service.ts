import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { ApiKeyStatusUpdaterRepository } from '@core/repositories/apiKey/ApiKeyStatusUpdater.repository';
import { ApiKeyKeyGeneratorRepository } from '@core/repositories/apiKey/ApiKeyKeyGenerator.repository';
import { ApiKeyCreatorRepository } from '@core/repositories/apiKey/ApiKeyCreator.repository';
import { injectable } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationService {
  constructor(
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    private readonly apiKeyStatusUpdaterRepository: ApiKeyStatusUpdaterRepository,
    private readonly apiKeyKeyGeneratorRepository: ApiKeyKeyGeneratorRepository,
    private readonly apiKeyCreatorRepository: ApiKeyCreatorRepository
  ) {}

  viewIntegration = async (
    accountId: string
  ): Promise<{
    api_key_id: string;
    key: string;
    name: string;
    status: string;
  } | null> => {
    return this.apiKeyViewerRepository.viewApiKeyByAccountId(accountId);
  };

  updateIntegrationStatus = async (
    accountId: string,
    status: EStatusApiKey
  ): Promise<boolean> => {
    const existingApiKey =
      await this.apiKeyViewerRepository.viewApiKeyByAccountId(accountId);

    if (!existingApiKey) {
      const apiKeyId = await this.apiKeyCreatorRepository.createApiKey(
        accountId,
        'Integração'
      );

      if (!apiKeyId) {
        return false;
      }

      if (status === EStatusApiKey.inactive) {
        return this.apiKeyStatusUpdaterRepository.updateApiKeyStatus(
          accountId,
          status
        );
      }

      return true;
    }

    return this.apiKeyStatusUpdaterRepository.updateApiKeyStatus(
      accountId,
      status
    );
  };

  generateNewKey = async (accountId: string): Promise<string | null> => {
    return this.apiKeyKeyGeneratorRepository.generateNewKey(accountId);
  };
}
