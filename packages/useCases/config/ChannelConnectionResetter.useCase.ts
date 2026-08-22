import { inject, injectable } from 'tsyringe';
import type { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';
import type { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';

@injectable()
export class ChannelConnectionResetterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerRecreatorUseCase)
    private readonly workerRecreatorUseCase: WorkerRecreatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string,
    debugTraceId?: string
  ): Promise<IWorkerLifecycleAck> {
    const worker =
      await this.workerService.viewWorkerForMonitorConsistent(channelId);

    if (
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== channelId ||
      !worker.account_id
    ) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerRecreatorUseCase.execute(
      t,
      worker.account_id,
      channelId,
      {
        remove_session: true,
        remove_volume: true,
        fresh_connection: true,
        debug_trace_id: debugTraceId,
      }
    );
  }
}
