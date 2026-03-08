import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { AiAgentService } from '@core/services/aiAgent.service';
import { UpdateAiAgentConfigRequest } from '@core/schema/worker/updateAiAgentConfig/request.schema';

@injectable()
export class UpdateAiAgentConfigUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateAiAgentConfigRequest
  ): Promise<{
    ai_agent_id: string | null;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const currentConfig = await this.workerConfigService.viewAiAgent(workerId);

    const aiAgentIdToSave =
      body.ai_agent_id === undefined
        ? currentConfig.ai_agent_id
        : body.ai_agent_id?.trim() || null;

    const enabledToSave =
      body.enabled === undefined ? currentConfig.enabled : body.enabled;

    if (aiAgentIdToSave) {
      const aiAgent = await this.aiAgentService.viewAiAgent(
        aiAgentIdToSave,
        accountId
      );

      if (!aiAgent) {
        throw new Error(t('ai_agent_not_found'));
      }
    }

    const result = await this.workerConfigService.updateAiAgent(
      workerId,
      aiAgentIdToSave,
      enabledToSave
    );

    return {
      ai_agent_id: result.ai_agent_id,
      enabled: result.enabled,
    };
  }
}
