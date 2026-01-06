import { injectable } from 'tsyringe';
import { AiAgentListerRepository } from '@core/repositories/aiAgent/AiAgentLister.repository';
import { AiAgentCreatorRepository } from '@core/repositories/aiAgent/AiAgentCreator.repository';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import { AiAgentUpdaterRepository } from '@core/repositories/aiAgent/AiAgentUpdater.repository';
import { AiAgentDeleterRepository } from '@core/repositories/aiAgent/AiAgentDeleter.repository';
import { AiAgentTypeListerRepository } from '@core/repositories/aiAgent/AiAgentTypeLister.repository';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';
import { ListAiAgentResponse } from '@core/schema/aiAgent/listAiAgent/response.schema';

@injectable()
export class AiAgentService {
  constructor(
    private readonly aiAgentListerRepository: AiAgentListerRepository,
    private readonly aiAgentCreatorRepository: AiAgentCreatorRepository,
    private readonly aiAgentViewerRepository: AiAgentViewerRepository,
    private readonly aiAgentUpdaterRepository: AiAgentUpdaterRepository,
    private readonly aiAgentDeleterRepository: AiAgentDeleterRepository,
    private readonly aiAgentTypeListerRepository: AiAgentTypeListerRepository
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
}
