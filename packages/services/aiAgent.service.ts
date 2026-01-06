import { injectable } from 'tsyringe';
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

@injectable()
export class AiAgentService {
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
    private readonly aiAgentPromptDeleterRepository: AiAgentPromptDeleterRepository
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

  createAiAgent = async (
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> => {
    return this.aiAgentCreatorRepository.createAiAgent(input, accountId);
  };

  viewAiAgent = async (
    aiAgentId: string,
    accountId: string
  ): Promise<ViewAiAgentResponse | null> => {
    return this.aiAgentViewerRepository.viewAiAgent(aiAgentId, accountId);
  };

  updateAiAgentById = async (
    input: UpdateAiAgentRequest,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.aiAgentUpdaterRepository.updateAiAgentById(
      input,
      aiAgentId,
      accountId
    );
  };

  deleteAiAgentById = async (
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.aiAgentDeleterRepository.deleteAiAgentById(
      aiAgentId,
      accountId
    );
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
}
