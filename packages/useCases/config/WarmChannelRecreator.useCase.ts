import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WarmChannelRecreatorUseCase {
  constructor(
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    warmPoolId: string
  ): Promise<{ enqueued: number }> {
    const warm = await this.workerWarmPoolRepository.viewById(warmPoolId);

    if (!warm || warm.state !== EWorkerWarmPoolState.ready) {
      throw new Error(t('warm_channel_not_found'));
    }

    await this.enqueueRecreate(warm);

    return { enqueued: 1 };
  }

  async enqueueRecreate(warm: IWorkerWarmPool): Promise<void> {
    await this.workerWarmPoolQueueService.ensure();
    await this.workerWarmPoolQueueService.publishDelete({
      request_id: uuidv7(),
      warm_pool_id: warm.warm_pool_id,
      server_id: warm.server_id,
      worker_type_id: warm.worker_type_id,
      container_id: warm.container_id,
      container_name: warm.container_name || `warm-${warm.warm_pool_id}`,
      session_volume_name: warm.session_volume_name,
      remove_volume: true,
      reason: 'manual',
      requested_at: currentTime(),
    });

    await this.workerWarmPoolQueueService.publishReplenish({
      request_id: uuidv7(),
      server_id: warm.server_id,
      worker_type_id: warm.worker_type_id,
      reason: 'manual',
      requested_at: currentTime(),
    });
  }
}
