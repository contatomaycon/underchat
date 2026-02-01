import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { AiAgentListerRepository } from '@core/repositories/aiAgent/AiAgentLister.repository';
import { AiAgentCreatorRepository } from '@core/repositories/aiAgent/AiAgentCreator.repository';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import { AiAgentUpdaterRepository } from '@core/repositories/aiAgent/AiAgentUpdater.repository';
import { AiAgentDeleterRepository } from '@core/repositories/aiAgent/AiAgentDeleter.repository';
import { AiAgentTypeListerRepository } from '@core/repositories/aiAgent/AiAgentTypeLister.repository';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';
import { AiAgentPromptCreatorRepository } from '@core/repositories/aiAgent/AiAgentPromptCreator.repository';
import { AiAgentPromptViewerRepository } from '@core/repositories/aiAgent/AiAgentPromptViewer.repository';
import { AiAgentPromptUpdaterRepository } from '@core/repositories/aiAgent/AiAgentPromptUpdater.repository';
import { AiAgentPromptDeleterRepository } from '@core/repositories/aiAgent/AiAgentPromptDeleter.repository';
import { AiAgentUsageListerRepository } from '@core/repositories/aiAgent/AiAgentUsageLister.repository';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';
import { ListAiAgentResponse } from '@core/schema/aiAgent/listAiAgent/response.schema';
import { ListAiAgentPromptRequest } from '@core/schema/aiAgent/listAiAgentPrompt/request.schema';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';
import { ViewAiAgentPromptResponse } from '@core/schema/aiAgent/viewAiAgentPrompt/response.schema';
import { ICreateAiAgentPromptInput } from '@core/common/interfaces/ICreateAiAgentPromptInput';
import { IUpdateAiAgentPromptInput } from '@core/common/interfaces/IUpdateAiAgentPromptInput';
import { ListChatbotAiAgentsResponse } from '@core/schema/chatbot/listAiAgents/response.schema';
import { ListAiAgentUsageResponseItem } from '@core/schema/aiAgent/listAiAgentUsage/response.schema';

@injectable()
export class AiAgentService {
  private readonly cacheTTL = 600;
  private readonly cacheKeyPrefix = 'ai-agent:view:';

  constructor(
    private readonly aiAgentListerRepository: AiAgentListerRepository,
    private readonly aiAgentCreatorRepository: AiAgentCreatorRepository,
    private readonly aiAgentViewerRepository: AiAgentViewerRepository,
    private readonly aiAgentUpdaterRepository: AiAgentUpdaterRepository,
    private readonly aiAgentDeleterRepository: AiAgentDeleterRepository,
    private readonly aiAgentTypeListerRepository: AiAgentTypeListerRepository,
    private readonly aiAgentPromptListerRepository: AiAgentPromptListerRepository,
    private readonly aiAgentPromptCreatorRepository: AiAgentPromptCreatorRepository,
    private readonly aiAgentPromptViewerRepository: AiAgentPromptViewerRepository,
    private readonly aiAgentPromptUpdaterRepository: AiAgentPromptUpdaterRepository,
    private readonly aiAgentPromptDeleterRepository: AiAgentPromptDeleterRepository,
    private readonly aiAgentUsageListerRepository: AiAgentUsageListerRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  listAiAgents = async (
    perPage: number,
    currentPage: number,
    query: ListAiAgentRequest,
    accountId: string
  ): Promise<[ListAiAgentResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.aiAgentListerRepository.listAiAgents(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.aiAgentListerRepository.listAiAgentsTotal(query, accountId),
    ]);

    return [result, total];
  };

  private getCacheKey(aiAgentId: string, accountId: string): string {
    return `${this.cacheKeyPrefix}${aiAgentId}:${accountId}`;
  }

  private async invalidateAiAgentCache(
    aiAgentId: string,
    accountId: string
  ): Promise<void> {
    const cacheKey = this.getCacheKey(aiAgentId, accountId);
    await this.redis.del(cacheKey);
  }

  createAiAgent = async (
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> => {
    const aiAgentId = await this.aiAgentCreatorRepository.createAiAgent(
      input,
      accountId
    );

    if (aiAgentId) {
      await this.invalidateAiAgentCache(aiAgentId, accountId);
    }

    return aiAgentId;
  };

  viewAiAgent = async (
    aiAgentId: string,
    accountId: string
  ): Promise<ViewAiAgentResponse | null> => {
    const cacheKey = this.getCacheKey(aiAgentId, accountId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as ViewAiAgentResponse;
    }

    const result = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (result) {
      await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
    }

    return result;
  };

  updateAiAgentById = async (
    input: UpdateAiAgentRequest,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.aiAgentUpdaterRepository.updateAiAgentById(
      input,
      aiAgentId,
      accountId
    );

    if (result) {
      await this.invalidateAiAgentCache(aiAgentId, accountId);
    }

    return result;
  };

  deleteAiAgentPromptsByAgentId = async (
    aiAgentId: string,
    accountId: string
  ): Promise<void> => {
    await this.aiAgentDeleterRepository.deleteAiAgentPromptsByAgentId(
      aiAgentId,
      accountId
    );
  };

  deleteAiAgentById = async (
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.aiAgentDeleterRepository.deleteAiAgentById(
      aiAgentId,
      accountId
    );

    if (result) {
      await this.invalidateAiAgentCache(aiAgentId, accountId);
    }

    return result;
  };

  listAiAgentTypes = async (): Promise<ListAiAgentTypeResponse[]> => {
    return this.aiAgentTypeListerRepository.listAiAgentTypes();
  };

  listAiAgentPrompts = async (
    query: ListAiAgentPromptRequest,
    accountId: string
  ): Promise<ListAiAgentPromptResponse[]> => {
    return this.aiAgentPromptListerRepository.listAiAgentPrompts(
      query,
      accountId
    );
  };

  createAiAgentPrompt = async (
    input: ICreateAiAgentPromptInput,
    accountId: string
  ): Promise<string | null> => {
    return this.aiAgentPromptCreatorRepository.createAiAgentPrompt(
      input,
      accountId
    );
  };

  viewAiAgentPrompt = async (
    aiAgentPromptId: string,
    accountId: string
  ): Promise<ViewAiAgentPromptResponse | null> => {
    return this.aiAgentPromptViewerRepository.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );
  };

  updateAiAgentPromptById = async (
    input: IUpdateAiAgentPromptInput,
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.aiAgentPromptUpdaterRepository.updateAiAgentPromptById(
      input,
      aiAgentPromptId,
      accountId
    );
  };

  deleteAiAgentPromptById = async (
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.aiAgentPromptDeleterRepository.deleteAiAgentPromptById(
      aiAgentPromptId,
      accountId
    );
  };

  listActiveAiAgentsForChatbot = async (
    accountId: string
  ): Promise<ListChatbotAiAgentsResponse> => {
    return this.aiAgentListerRepository.listActiveAiAgentsForChatbot(accountId);
  };

  totalAiAgentByAccountId = async (accountId: string): Promise<number> => {
    return this.aiAgentListerRepository.totalAiAgentByAccountId(accountId);
  };

  updateAiAgentOpenAIIds = async (
    aiAgentId: string,
    accountId: string,
    ids: {
      openai_assistant_id?: string;
      openai_vector_store_id?: string;
    }
  ): Promise<boolean> => {
    const result = await this.aiAgentUpdaterRepository.updateAiAgentOpenAIIds(
      aiAgentId,
      accountId,
      ids
    );

    if (result) {
      await this.invalidateAiAgentCache(aiAgentId, accountId);
    }

    return result;
  };

  updateAiAgentPromptOpenAIFileId = async (
    aiAgentPromptId: string,
    accountId: string,
    openaiFileId: string | null
  ): Promise<boolean> => {
    return this.aiAgentPromptUpdaterRepository.updateAiAgentPromptOpenAIFileId(
      aiAgentPromptId,
      accountId,
      openaiFileId
    );
  };

  listAiAgentUsage = async (
    aiAgentId: string,
    accountId: string,
    perPage: number,
    currentPage: number
  ): Promise<[ListAiAgentUsageResponseItem[], number]> => {
    const [results, total] = await Promise.all([
      this.aiAgentUsageListerRepository.listByAiAgentId(
        aiAgentId,
        accountId,
        perPage,
        currentPage
      ),
      this.aiAgentUsageListerRepository.totalByAiAgentId(aiAgentId, accountId),
    ]);

    return [results, total];
  };
}
