import { injectable, inject } from 'tsyringe';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';

@injectable()
export class AiAgentTypeListerUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(): Promise<ListAiAgentTypeResponse[]> {
    return this.aiAgentService.listAiAgentTypes();
  }
}
