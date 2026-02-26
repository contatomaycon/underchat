import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';

@injectable()
export class ChannelUpdaterUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(WorkerUpdaterUseCase)
    private readonly workerUpdaterUseCase: WorkerUpdaterUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: UpdateChannelRequest
  ): Promise<boolean> {
    const viewWorkerBalancer = await this.configService.viewChannelBalancer(
      input.channel_id
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('channel_not_found'));
    }

    return this.workerUpdaterUseCase.execute(t, viewWorkerBalancer.account_id, {
      worker_id: input.channel_id,
      name: input.name,
      worker_type: input.worker_type,
      server_id: input.server_id,
    });
  }
}
