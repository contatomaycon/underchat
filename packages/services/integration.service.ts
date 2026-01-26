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
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappings } from '@core/mappings/webhook.mappings';
import { injectable } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';
import { ListIntegrationsResponse } from '@core/schema/integration/listIntegrations/response.schema';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { CreateIntegrationResponse } from '@core/schema/integration/createIntegration/response.schema';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';
import { ViewIntegrationByIdResponse } from '@core/schema/integration/viewIntegrationById/response.schema';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';
import { UserService } from './user.service';
import { SectorService } from './sector.service';
import { ChatbotService } from './chatbot.service';
import { ListIntegrationUsersResponse } from '@core/schema/integration/listUsers/response.schema';
import { ListIntegrationSectorsResponse } from '@core/schema/integration/listSectors/response.schema';
import { ListIntegrationSectorUsersResponse } from '@core/schema/integration/listSectorUsers/response.schema';
import { ListIntegrationInputChatbotsResponse } from '@core/schema/integration/listInputChatbots/response.schema';
import { EChatbotType } from '@core/common/enums/EChatbotType';

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
    private readonly webhookDataViewerRepository: WebhookDataViewerRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly chatbotService: ChatbotService
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

  saveWebhookData = async (
    accountId: string,
    workerId: string,
    data: Record<string, unknown>
  ): Promise<boolean> => {
    const mappings = webhookMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook,
      mappings
    );

    if (!result) {
      return false;
    }

    const documentId = `${accountId}_${workerId}`;
    const indexResult = await this.elasticDatabaseService.indexWithOCC(
      EElasticIndex.webhook,
      documentId,
      data,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return indexResult === 'updated' || indexResult === 'created';
  };

  listUsersForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationUsersResponse> => {
    const users = await this.userService.listUsersForTransfer(accountId);
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  };

  listSectorsForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationSectorsResponse> => {
    const sectors = await this.sectorService.listSectorsForTransfer(accountId);
    return sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
      color: sector.color ?? null,
    }));
  };

  listSectorUsersForWebhook = async (
    accountId: string,
    sectorId: string
  ): Promise<ListIntegrationSectorUsersResponse> => {
    const users = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  };

  listInputChatbotsForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationInputChatbotsResponse> => {
    const chatbots = await this.chatbotService.listChatbots(accountId);
    const inputChatbots = chatbots.filter(
      (chatbot) => chatbot.type === EChatbotType.input
    );
    return inputChatbots.map((chatbot) => ({
      chatbot_id: chatbot.chatbot_id,
      name: chatbot.name,
      type: chatbot.type ?? null,
      created_at: chatbot.created_at,
    }));
  };
}
