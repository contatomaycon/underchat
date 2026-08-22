import { injectable, inject } from 'tsyringe';
import { ChatbotCreatorRepository } from '@core/repositories/chatbot/ChatbotCreator.repository';
import { ChatbotListerRepository } from '@core/repositories/chatbot/ChatbotLister.repository';
import { ChatbotUpdaterRepository } from '@core/repositories/chatbot/ChatbotUpdater.repository';
import { ChatbotDeleterRepository } from '@core/repositories/chatbot/ChatbotDeleter.repository';
import { ChatbotNameExistsRepository } from '@core/repositories/chatbot/ChatbotNameExists.repository';
import { ChatbotChatTagsListerRepository } from '@core/repositories/labelTemplate/ChatbotChatTagsLister.repository';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { UpdateChatbotRequest } from '@core/schema/chatbot/updateChatbot/request.schema';
import { UpdateChatbotResponse } from '@core/schema/chatbot/updateChatbot/response.schema';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ListChatbotUsersResponse } from '@core/schema/chatbot/listUsers/response.schema';
import { ListChatbotSectorsResponse } from '@core/schema/chatbot/listSectors/response.schema';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';
import { ListChatbotAiAgentsResponse } from '@core/schema/chatbot/listAiAgents/response.schema';
import { ListChatbotRandomMessagesResponse } from '@core/schema/chatbot/listRandomMessages/response.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import { SaveChatbotFlowRequestData } from '@core/schema/chatbot/saveChatbotFlow/request.schema';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { v7 as uuidv7 } from 'uuid';
import { WorkerService } from '@core/services/worker.service';
import { ListChatbotChannelsResponse } from '@core/schema/chatbot/listChannels/response.schema';
import { OfficialCapabilitiesResponse } from '@core/schema/chatbot/officialCapabilities/response.schema';
import { ChatbotOfficialCompatibilityRepository } from '@core/repositories/chatbot/ChatbotOfficialCompatibility.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';
import { isOfficialWaitForResponseNodeType } from '@core/common/functions/chatbotOfficialNodes';

type ElasticHit<T> = {
  _source?: T;
};

type ChatbotFlowNode = SaveChatbotFlowRequestData['nodes'][number];

@injectable()
export class ChatbotService {
  constructor(
    @inject(ChatbotCreatorRepository)
    private readonly chatbotCreatorRepository: ChatbotCreatorRepository,
    @inject(ChatbotListerRepository)
    private readonly chatbotListerRepository: ChatbotListerRepository,
    @inject(ChatbotUpdaterRepository)
    private readonly chatbotUpdaterRepository: ChatbotUpdaterRepository,
    @inject(ChatbotDeleterRepository)
    private readonly chatbotDeleterRepository: ChatbotDeleterRepository,
    @inject(ChatbotNameExistsRepository)
    private readonly chatbotNameExistsRepository: ChatbotNameExistsRepository,
    @inject(ChatbotChatTagsListerRepository)
    private readonly chatbotChatTagsListerRepository: ChatbotChatTagsListerRepository,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService,
    @inject(ChatbotOfficialCompatibilityRepository)
    private readonly chatbotOfficialCompatibilityRepository: ChatbotOfficialCompatibilityRepository,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  existsChatbotByName = async (
    name: string,
    accountId: string,
    excludeChatbotId?: string
  ): Promise<boolean> => {
    return this.chatbotNameExistsRepository.existsChatbotByName(
      name,
      accountId,
      excludeChatbotId
    );
  };

  createChatbot = async (
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<CreateChatbotResponse | null> => {
    return this.chatbotCreatorRepository.createChatbot(input, accountId);
  };

  updateChatbot = async (
    chatbotId: string,
    input: UpdateChatbotRequest
  ): Promise<UpdateChatbotResponse | null> => {
    return this.chatbotUpdaterRepository.updateChatbot(chatbotId, input);
  };

  listChatbots = async (accountId: string): Promise<ListChatbotResponse[]> => {
    return this.chatbotListerRepository.listChatbots(accountId);
  };

  isChatbotActive = async (
    accountId: string,
    chatbotId: string
  ): Promise<boolean> => {
    const chatbots = await this.listChatbots(accountId);
    const item = chatbots.find((chatbot) => chatbot.chatbot_id === chatbotId);

    return item?.status === EChatbotStatus.active;
  };

  listChatbotTags = async (
    accountId: string
  ): Promise<ChatbotChatTagResponse[]> => {
    return this.chatbotChatTagsListerRepository.listChatbotChatTags(accountId);
  };

  listChatbotUsers = async (
    accountId: string,
    channelId?: string
  ): Promise<ListChatbotUsersResponse> => {
    if (!channelId) {
      return this.userService.listUsersForTransfer(accountId);
    }

    const [allUsers, allowedUserIds] = await Promise.all([
      this.userService.listUsersForTransfer(accountId),
      this.userService.listUserIdsWithAccessToChannel(accountId, channelId),
    ]);

    if (allowedUserIds.length === 0) {
      return [];
    }

    const allowedIdsSet = new Set(allowedUserIds);
    return allUsers.filter((user) => allowedIdsSet.has(user.id));
  };

  listChatbotSectors = async (
    accountId: string
  ): Promise<ListChatbotSectorsResponse> => {
    return this.sectorService.listSectorsForTransfer(accountId);
  };

  listChatbotSectorUsers = async (
    accountId: string,
    sectorId: string,
    channelId?: string
  ): Promise<ChatbotSectorUserResponse[]> => {
    const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );

    if (!channelId) {
      return sectorUsers;
    }

    const allowedUserIds =
      await this.userService.listUserIdsWithAccessToChannel(
        accountId,
        channelId
      );

    if (allowedUserIds.length === 0) {
      return [];
    }

    const allowedIdsSet = new Set(allowedUserIds);
    return sectorUsers.filter((user) => allowedIdsSet.has(user.id));
  };

  listChatbotChannels = async (
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListChatbotChannelsResponse> => {
    const channels = await this.workerService.listAllWorkers(accountId);

    if (userChannels.length === 0) {
      return channels;
    }

    const allowedChannelIds = new Set(
      userChannels.map((channel) => channel.id)
    );
    return channels.filter((channel) => allowedChannelIds.has(channel.id));
  };

  listChatbotAiAgents = async (
    accountId: string
  ): Promise<ListChatbotAiAgentsResponse> => {
    return this.aiAgentService.listActiveAiAgentsForChatbot(accountId);
  };

  getOfficialCapabilities = async (
    accountId: string,
    chatbotId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<OfficialCapabilitiesResponse> => {
    const [channels, linkedWorkerTypes] = await Promise.all([
      this.listChatbotChannels(accountId, userChannels),
      this.chatbotOfficialCompatibilityRepository.listActiveLinkedWorkerTypes(
        accountId,
        chatbotId
      ),
    ]);

    const hasOfficialOnlineChannel = channels.some(
      (channel) => channel.is_official === true
    );
    const linkedOfficial = linkedWorkerTypes.some(
      (item) => item.worker_type_id === EWorkerType.whatsapp
    );
    const linkedNonOfficial = linkedWorkerTypes.some(
      (item) => item.worker_type_id !== EWorkerType.whatsapp
    );

    let linkedChannelType: OfficialCapabilitiesResponse['linked_channel_type'] =
      'none';
    if (linkedOfficial && linkedNonOfficial) {
      linkedChannelType = 'mixed';
    } else if (linkedOfficial) {
      linkedChannelType = 'official';
    } else if (linkedNonOfficial) {
      linkedChannelType = 'non_official';
    }

    return {
      has_official_online_channel: hasOfficialOnlineChannel,
      has_non_official_linked_channel: linkedNonOfficial,
      linked_channel_type: linkedChannelType,
      can_use_official_nodes:
        hasOfficialOnlineChannel && linkedNonOfficial === false,
    };
  };

  hasOfficialOnlineChannel = async (
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<boolean> => {
    const channels = await this.listChatbotChannels(accountId, userChannels);
    return channels.some((channel) => channel.is_official === true);
  };

  hasNonOfficialLinkedChannel = async (
    accountId: string,
    chatbotId: string
  ): Promise<boolean> => {
    const linkedWorkerTypes =
      await this.chatbotOfficialCompatibilityRepository.listActiveLinkedWorkerTypes(
        accountId,
        chatbotId
      );

    return linkedWorkerTypes.some(
      (item) => item.worker_type_id !== EWorkerType.whatsapp
    );
  };

  private normalizeCoordinateValueForStorage(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const numericValue = Number(trimmed);
      return Number.isFinite(numericValue) ? trimmed : null;
    }

    return null;
  }

  private getCanonicalOfficialContinueType(
    nodeType: string
  ): 'automatic' | 'after_response' | null {
    if (nodeType === 'officialCtaUrl') {
      return 'automatic';
    }

    return isOfficialWaitForResponseNodeType(nodeType)
      ? 'after_response'
      : null;
  }

  private normalizeFlowNodesForStorage(
    nodes: SaveChatbotFlowRequestData['nodes']
  ): SaveChatbotFlowRequestData['nodes'] {
    return nodes.map((node) => {
      const data = node.data as Record<string, unknown>;
      const canonicalContinueType = this.getCanonicalOfficialContinueType(
        node.type
      );
      const shouldNormalizeContinueType =
        canonicalContinueType !== null &&
        data.continueType !== canonicalContinueType;
      const hasLatitude = Object.prototype.hasOwnProperty.call(
        data,
        'latitude'
      );
      const hasLongitude = Object.prototype.hasOwnProperty.call(
        data,
        'longitude'
      );

      if (!hasLatitude && !hasLongitude && !shouldNormalizeContinueType) {
        return node;
      }

      const nextData: Record<string, unknown> = { ...data };

      if (shouldNormalizeContinueType) {
        nextData.continueType = canonicalContinueType;
      }

      if (!hasLatitude && !hasLongitude) {
        return {
          ...node,
          data: nextData,
        } as ChatbotFlowNode;
      }

      const latitudeText = this.normalizeCoordinateValueForStorage(
        data.latitude
      );
      const longitudeText = this.normalizeCoordinateValueForStorage(
        data.longitude
      );

      delete nextData.latitude;
      delete nextData.longitude;

      if (latitudeText) {
        nextData.latitudeText = latitudeText;
      } else {
        delete nextData.latitudeText;
      }

      if (longitudeText) {
        nextData.longitudeText = longitudeText;
      } else {
        delete nextData.longitudeText;
      }

      return {
        ...node,
        data: nextData,
      } as ChatbotFlowNode;
    });
  }

  private hydrateFlowNodesFromStorage(
    nodes: ListChatbotFlowResponse['nodes']
  ): ListChatbotFlowResponse['nodes'] {
    return nodes.map((node): ListChatbotFlowResponse['nodes'][number] => {
      const data = node.data as Record<string, unknown>;
      const canonicalContinueType = this.getCanonicalOfficialContinueType(
        node.type
      );
      const shouldNormalizeContinueType =
        canonicalContinueType !== null &&
        data.continueType !== canonicalContinueType;
      const latitude =
        typeof data.latitude === 'number' || typeof data.latitude === 'string'
          ? data.latitude
          : this.normalizeCoordinateValueForStorage(data.latitudeText);
      const longitude =
        typeof data.longitude === 'number' || typeof data.longitude === 'string'
          ? data.longitude
          : this.normalizeCoordinateValueForStorage(data.longitudeText);

      if (
        latitude === data.latitude &&
        longitude === data.longitude &&
        !shouldNormalizeContinueType
      ) {
        return node;
      }

      const nextData: ListChatbotFlowResponse['nodes'][number]['data'] = {
        ...node.data,
      };

      if (latitude !== null && latitude !== undefined) {
        nextData.latitude = latitude;
      }

      if (longitude !== null && longitude !== undefined) {
        nextData.longitude = longitude;
      }

      if (shouldNormalizeContinueType) {
        nextData.continueType = canonicalContinueType;
      }

      return {
        ...node,
        data: nextData,
      };
    });
  }

  listChatbotRandomMessages = async (
    accountId: string
  ): Promise<ListChatbotRandomMessagesResponse> => {
    return this.randomMessageService.listActiveRandomMessagesForChatbot(
      accountId
    );
  };

  saveChatbotFlow = async (
    input: SaveChatbotFlowRequestData,
    accountId: string
  ): Promise<string | null> => {
    const mappings = chatbotFlowMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.chatbot_flow,
      mappings
    );

    if (!result) {
      return null;
    }

    const chatbotFlowId = uuidv7();
    const now = new Date().toISOString();

    const chatbotFlow = {
      chatbot_flow_id: chatbotFlowId,
      chatbot_id: input.chatbot_id,
      account_id: accountId,
      nodes: this.normalizeFlowNodesForStorage(input.nodes),
      edges: input.edges,
      created_at: now,
      updated_at: now,
    };

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.chatbot_flow,
      chatbotFlowId,
      chatbotFlow as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    if (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    ) {
      return chatbotFlowId;
    }

    return null;
  };

  findChatbotFlowByChatbotId = async (
    accountId: string,
    chatbotId: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<ListChatbotFlowResponse | null> => {
    if (
      !options.includeInactive &&
      !(await this.isChatbotActive(accountId, chatbotId))
    ) {
      return null;
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              term: {
                account_id: accountId,
              },
            },
            {
              term: {
                chatbot_id: chatbotId,
              },
            },
          ],
        },
      },
      sort: [
        {
          created_at: {
            order: 'desc',
          },
        },
      ],
    };

    const result =
      await this.elasticDatabaseService.select<ListChatbotFlowResponse>(
        EElasticIndex.chatbot_flow,
        queryElastic
      );

    const hit = result?.hits?.hits?.[0] as
      ElasticHit<ListChatbotFlowResponse> | undefined;

    if (!hit?._source) {
      return null;
    }

    return {
      ...hit._source,
      nodes: this.hydrateFlowNodesFromStorage(hit._source.nodes),
    };
  };

  findChatbotFlowById = async (
    accountId: string,
    chatbotId: string,
    chatbotFlowId: string
  ): Promise<ListChatbotFlowResponse | null> => {
    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          filter: [
            { term: { account_id: accountId } },
            { term: { chatbot_id: chatbotId } },
            { term: { chatbot_flow_id: chatbotFlowId } },
          ],
        },
      },
    };

    const result =
      await this.elasticDatabaseService.select<ListChatbotFlowResponse>(
        EElasticIndex.chatbot_flow,
        queryElastic
      );
    const hit = result?.hits?.hits?.[0] as
      ElasticHit<ListChatbotFlowResponse> | undefined;

    if (!hit?._source) {
      return null;
    }

    return {
      ...hit._source,
      nodes: this.hydrateFlowNodesFromStorage(hit._source.nodes),
    };
  };

  saveChatbotFlowConfigurations = async (
    input: SaveChatbotFlowConfigurationsRequest,
    accountId: string
  ): Promise<string | null> => {
    const mappings = chatbotFlowMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.chatbot_flow_configurations,
      mappings
    );

    if (!result) {
      return null;
    }

    const chatbotConfigurationsId = uuidv7();
    const now = new Date().toISOString();

    const chatbotFlowConfigurations = {
      chatbot_configurations_id: chatbotConfigurationsId,
      chatbot_id: input.chatbot_id,
      account_id: accountId,
      configurations: input.configurations,
      created_at: now,
      updated_at: now,
    };

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.chatbot_flow_configurations,
      chatbotConfigurationsId,
      chatbotFlowConfigurations as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    if (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    ) {
      return chatbotConfigurationsId;
    }

    return null;
  };

  findChatbotFlowConfigurationsByChatbotId = async (
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowConfigurationsResponse | null> => {
    if (!(await this.isChatbotActive(accountId, chatbotId))) {
      return null;
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              term: {
                account_id: accountId,
              },
            },
            {
              term: {
                chatbot_id: chatbotId,
              },
            },
          ],
        },
      },
      sort: [
        {
          created_at: {
            order: 'desc',
          },
        },
      ],
    };

    const result =
      await this.elasticDatabaseService.select<ListChatbotFlowConfigurationsResponse>(
        EElasticIndex.chatbot_flow_configurations,
        queryElastic
      );

    const hit = result?.hits?.hits?.[0] as
      ElasticHit<ListChatbotFlowConfigurationsResponse> | undefined;
    return hit?._source ?? null;
  };

  deleteChatbotFlowByChatbotId = async (
    chatbotId: string
  ): Promise<boolean> => {
    const deletedFlow = await this.elasticDatabaseService.deleteAllByQuery(
      EElasticIndex.chatbot_flow,
      {
        term: {
          chatbot_id: chatbotId,
        },
      }
    );

    return deletedFlow;
  };

  deleteChatbotFlowConfigurationsByChatbotId = async (
    chatbotId: string
  ): Promise<boolean> => {
    const deletedConfigurations =
      await this.elasticDatabaseService.deleteAllByQuery(
        EElasticIndex.chatbot_flow_configurations,
        {
          term: {
            chatbot_id: chatbotId,
          },
        }
      );

    return deletedConfigurations;
  };

  clearChatbotFromSchedules = async (chatbotId: string): Promise<void> => {
    await this.chatbotDeleterRepository.clearChatbotFromSchedules(chatbotId);
  };

  clearChatbotFromWorkerConfigs = async (chatbotId: string): Promise<void> => {
    await this.chatbotDeleterRepository.clearChatbotFromWorkerConfigs(
      chatbotId
    );
  };

  deleteChatbotById = async (chatbotId: string): Promise<boolean> => {
    return this.chatbotDeleterRepository.deleteChatbotById(chatbotId);
  };
}
