import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { IntegrationListerRepository } from '@core/repositories/integration/IntegrationLister.repository';
import { IntegrationCreatorRepository } from '@core/repositories/integration/IntegrationCreator.repository';
import { IntegrationUpdaterRepository } from '@core/repositories/integration/IntegrationUpdater.repository';
import { IntegrationDeleterRepository } from '@core/repositories/integration/IntegrationDeleter.repository';
import { IntegrationViewerByIdRepository } from '@core/repositories/integration/IntegrationViewerById.repository';
import { IntegrationStatusUpdaterRepository } from '@core/repositories/integration/IntegrationStatusUpdater.repository';
import { IntegrationKeyGeneratorRepository } from '@core/repositories/integration/IntegrationKeyGenerator.repository';
import { IntegrationAvailableChannelsListerRepository } from '@core/repositories/integration/IntegrationAvailableChannelsLister.repository';
import { WebhookMappingViewerRepository } from '@core/repositories/webhookMapping/WebhookMappingViewer.repository';
import { WebhookMappingSaverRepository } from '@core/repositories/webhookMapping/WebhookMappingSaver.repository';
import { WebhookDataViewerRepository } from '@core/repositories/webhook/WebhookDataViewer.repository';
import { injectable } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';
import { ListIntegrationsResponse } from '@core/schema/integration/listIntegrations/response.schema';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { CreateIntegrationResponse } from '@core/schema/integration/createIntegration/response.schema';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';
import { ViewIntegrationByIdResponse } from '@core/schema/integration/viewIntegrationById/response.schema';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';

@injectable()
export class IntegrationService {
  constructor(
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    private readonly integrationListerRepository: IntegrationListerRepository,
    private readonly integrationCreatorRepository: IntegrationCreatorRepository,
    private readonly integrationUpdaterRepository: IntegrationUpdaterRepository,
    private readonly integrationDeleterRepository: IntegrationDeleterRepository,
    private readonly integrationViewerByIdRepository: IntegrationViewerByIdRepository,
    private readonly integrationStatusUpdaterRepository: IntegrationStatusUpdaterRepository,
    private readonly integrationKeyGeneratorRepository: IntegrationKeyGeneratorRepository,
    private readonly integrationAvailableChannelsListerRepository: IntegrationAvailableChannelsListerRepository,
    private readonly webhookMappingViewerRepository: WebhookMappingViewerRepository,
    private readonly webhookMappingSaverRepository: WebhookMappingSaverRepository,
    private readonly webhookDataViewerRepository: WebhookDataViewerRepository
  ) {}

  listIntegrations = async (
    accountId: string,
    request: ListIntegrationsRequest
  ): Promise<ListIntegrationsResponse> => {
    const perPage = request.per_page ?? 10;
    const currentPage = request.current_page ?? 1;

    const [results, total] = await Promise.all([
      this.integrationListerRepository.listIntegrations(
        accountId,
        perPage,
        currentPage,
        request
      ),
      this.integrationListerRepository.listIntegrationsTotal(
        accountId,
        request
      ),
    ]);

    const totalPages = Math.ceil(total / perPage);

    return {
      results,
      pagings: {
        current_page: currentPage,
        total_pages: totalPages,
        per_page: perPage,
        count: results.length,
        total,
      },
    };
  };

  createIntegration = async (
    accountId: string,
    request: CreateIntegrationRequest
  ): Promise<CreateIntegrationResponse | null> => {
    const apiKeyId = await this.integrationCreatorRepository.createIntegration(
      accountId,
      request.name,
      request.worker_id
    );

    if (!apiKeyId) {
      return null;
    }

    const apiKey = await this.apiKeyViewerRepository.viewApiKeyById(apiKeyId);
    if (!apiKey) {
      return null;
    }

    return {
      api_key_id: apiKeyId,
      key: apiKey.key,
    };
  };

  updateIntegration = async (
    accountId: string,
    apiKeyId: string,
    request: UpdateIntegrationRequest
  ): Promise<boolean> => {
    return this.integrationUpdaterRepository.updateIntegration(
      accountId,
      apiKeyId,
      request.name,
      request.worker_id
    );
  };

  deleteIntegration = async (
    accountId: string,
    apiKeyId: string
  ): Promise<boolean> => {
    return this.integrationDeleterRepository.deleteIntegration(
      accountId,
      apiKeyId
    );
  };

  viewIntegrationById = async (
    accountId: string,
    apiKeyId: string
  ): Promise<ViewIntegrationByIdResponse | null> => {
    return this.integrationViewerByIdRepository.viewIntegrationById(
      accountId,
      apiKeyId
    );
  };

  updateIntegrationStatus = async (
    accountId: string,
    apiKeyId: string,
    status: EStatusApiKey
  ): Promise<boolean> => {
    return this.integrationStatusUpdaterRepository.updateIntegrationStatus(
      accountId,
      apiKeyId,
      status
    );
  };

  generateNewKey = async (
    accountId: string,
    apiKeyId: string
  ): Promise<string | null> => {
    return this.integrationKeyGeneratorRepository.generateNewKey(
      accountId,
      apiKeyId
    );
  };

  viewWebhookMapping = async (
    accountId: string,
    apiKeyId: string
  ): Promise<{
    account_id: string;
    worker_id: string | null;
    mapping: Record<string, string>;
    created_at?: string;
    updated_at?: string;
  } | null> => {
    const apiKey = await this.apiKeyViewerRepository.viewApiKeyById(apiKeyId);

    if (!apiKey || !apiKey.worker_id) {
      return null;
    }

    return this.webhookMappingViewerRepository.viewWebhookMapping(
      accountId,
      apiKey.worker_id
    );
  };

  saveWebhookMapping = async (
    accountId: string,
    apiKeyId: string,
    mapping: Record<string, string>
  ): Promise<boolean> => {
    const apiKey = await this.apiKeyViewerRepository.viewApiKeyById(apiKeyId);

    if (!apiKey || !apiKey.worker_id) {
      return false;
    }

    return this.webhookMappingSaverRepository.saveWebhookMapping(
      accountId,
      apiKey.worker_id,
      mapping
    );
  };

  viewWebhookData = async (
    accountId: string,
    apiKeyId: string
  ): Promise<unknown | null> => {
    const apiKey = await this.apiKeyViewerRepository.viewApiKeyById(apiKeyId);

    if (!apiKey || !apiKey.worker_id) {
      return null;
    }

    return this.webhookDataViewerRepository.viewWebhookData(
      accountId,
      apiKey.worker_id
    );
  };

  listAvailableChannels = async (
    accountId: string
  ): Promise<ListAvailableChannelsResponse> => {
    return this.integrationAvailableChannelsListerRepository.listAvailableChannels(
      accountId
    );
  };
}
