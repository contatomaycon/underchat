import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { ApiKeyStatusUpdaterRepository } from '@core/repositories/apiKey/ApiKeyStatusUpdater.repository';
import { ApiKeyKeyGeneratorRepository } from '@core/repositories/apiKey/ApiKeyKeyGenerator.repository';
import { injectable } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationService {
  constructor(
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    private readonly apiKeyStatusUpdaterRepository: ApiKeyStatusUpdaterRepository,
    private readonly apiKeyKeyGeneratorRepository: ApiKeyKeyGeneratorRepository
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
    return this.apiKeyStatusUpdaterRepository.updateApiKeyStatus(
      accountId,
      status
    );
  };

  generateNewKey = async (accountId: string): Promise<string | null> => {
    return this.apiKeyKeyGeneratorRepository.generateNewKey(accountId);
  };
}
