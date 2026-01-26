import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { ApiKeyStatusUpdaterRepository } from '@core/repositories/apiKey/ApiKeyStatusUpdater.repository';
import { ApiKeyKeyGeneratorRepository } from '@core/repositories/apiKey/ApiKeyKeyGenerator.repository';
import { ApiKeyCreatorRepository } from '@core/repositories/apiKey/ApiKeyCreator.repository';
import { WebhookMappingViewerRepository } from '@core/repositories/webhookMapping/WebhookMappingViewer.repository';
import { WebhookMappingSaverRepository } from '@core/repositories/webhookMapping/WebhookMappingSaver.repository';
import { WebhookDataViewerRepository } from '@core/repositories/webhook/WebhookDataViewer.repository';
import { injectable } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class IntegrationService {
  constructor(
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    private readonly apiKeyStatusUpdaterRepository: ApiKeyStatusUpdaterRepository,
    private readonly apiKeyKeyGeneratorRepository: ApiKeyKeyGeneratorRepository,
    private readonly apiKeyCreatorRepository: ApiKeyCreatorRepository,
    private readonly webhookMappingViewerRepository: WebhookMappingViewerRepository,
    private readonly webhookMappingSaverRepository: WebhookMappingSaverRepository,
    private readonly webhookDataViewerRepository: WebhookDataViewerRepository
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

  viewWebhookMapping = async (
    accountId: string
  ): Promise<{
    account_id: string;
    mapping: Record<string, string>;
    created_at?: string;
    updated_at?: string;
  } | null> => {
    return this.webhookMappingViewerRepository.viewWebhookMapping(accountId);
  };

  saveWebhookMapping = async (
    accountId: string,
    mapping: Record<string, string>
  ): Promise<boolean> => {
    return this.webhookMappingSaverRepository.saveWebhookMapping(
      accountId,
      mapping
    );
  };

  viewWebhookData = async (accountId: string): Promise<unknown | null> => {
    return this.webhookDataViewerRepository.viewWebhookData(accountId);
  };
}
