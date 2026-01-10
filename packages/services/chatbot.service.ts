import { injectable } from 'tsyringe';
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
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import { SaveChatbotFlowRequestData } from '@core/schema/chatbot/saveChatbotFlow/request.schema';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';
import { v7 as uuidv7 } from 'uuid';

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class ChatbotService {
  constructor(
    private readonly chatbotCreatorRepository: ChatbotCreatorRepository,
    private readonly chatbotListerRepository: ChatbotListerRepository,
    private readonly chatbotUpdaterRepository: ChatbotUpdaterRepository,
    private readonly chatbotDeleterRepository: ChatbotDeleterRepository,
    private readonly chatbotNameExistsRepository: ChatbotNameExistsRepository,
    private readonly chatbotChatTagsListerRepository: ChatbotChatTagsListerRepository,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly aiAgentService: AiAgentService,
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

  listChatbotTags = async (
    accountId: string
  ): Promise<ChatbotChatTagResponse[]> => {
    return this.chatbotChatTagsListerRepository.listChatbotChatTags(accountId);
  };

  listChatbotUsers = async (
    accountId: string
  ): Promise<ListChatbotUsersResponse> => {
    return this.userService.listUsersForTransfer(accountId);
  };

  listChatbotSectors = async (
    accountId: string
  ): Promise<ListChatbotSectorsResponse> => {
    return this.sectorService.listSectorsForTransfer(accountId);
  };

  listChatbotSectorUsers = async (
    accountId: string,
    sectorId: string
  ): Promise<ChatbotSectorUserResponse[]> => {
    return this.sectorService.listSectorUsersForTransfer(accountId, sectorId);
  };

  listChatbotAiAgents = async (
    accountId: string
  ): Promise<ListChatbotAiAgentsResponse> => {
    return this.aiAgentService.listActiveAiAgentsForChatbot(accountId);
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
      nodes: input.nodes,
      edges: input.edges,
      created_at: now,
      updated_at: now,
    };

    const saved = await this.elasticDatabaseService.update(
      EElasticIndex.chatbot_flow,
      chatbotFlow,
      chatbotFlowId
    );

    return saved ? chatbotFlowId : null;
  };

  findChatbotFlowByChatbotId = async (
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowResponse | null> => {
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
      | ElasticHit<ListChatbotFlowResponse>
      | undefined;
    return hit?._source ?? null;
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

    const saved = await this.elasticDatabaseService.update(
      EElasticIndex.chatbot_flow_configurations,
      chatbotFlowConfigurations,
      chatbotConfigurationsId
    );

    return saved ? chatbotConfigurationsId : null;
  };

  findChatbotFlowConfigurationsByChatbotId = async (
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowConfigurationsResponse | null> => {
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
      | ElasticHit<ListChatbotFlowConfigurationsResponse>
      | undefined;
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

  clearChatbotFromWorkerConfigs = async (chatbotId: string): Promise<void> => {
    await this.chatbotDeleterRepository.clearChatbotFromWorkerConfigs(
      chatbotId
    );
  };

  deleteChatbotById = async (chatbotId: string): Promise<boolean> => {
    return this.chatbotDeleterRepository.deleteChatbotById(chatbotId);
  };
}
