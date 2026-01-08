import { injectable } from 'tsyringe';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ViewAiAgentConfigResponse } from '@core/schema/aiAgent/viewAiAgentConfig/response.schema';

@injectable()
export class ViewAiAgentConfigUseCase {
  constructor(private readonly workerConfigService: WorkerConfigService) {}

  async execute(accountId: string): Promise<ViewAiAgentConfigResponse> {
    const response =
      await this.workerConfigService.viewAiAgentConfigByAccountId(accountId);

    return response;
  }
}
