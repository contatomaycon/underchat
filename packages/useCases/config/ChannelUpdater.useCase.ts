import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';

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
    input: UpdateChannelRequest,
    debugTraceId?: string
  ): Promise<boolean | IWorkerLifecycleAck> {
    const channelContext = await this.configService.viewChannelContext(
      input.channel_id
    );

    if (!channelContext) {
      throw new Error(t('channel_not_found'));
    }

    const workerInput = {
      worker_id: input.channel_id,
      name: input.name,
      worker_type: input.worker_type,
      server_id: input.server_id,
    };

    if (debugTraceId) {
      return this.workerUpdaterUseCase.execute(
        t,
        channelContext.account_id,
        workerInput,
        debugTraceId
      );
    }

    return this.workerUpdaterUseCase.execute(
      t,
      channelContext.account_id,
      workerInput
    );
  }
}
