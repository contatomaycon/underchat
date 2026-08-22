import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { RecreateWarmChannelsAllRequest } from '@core/schema/config/recreateWarmChannelsAll/request.schema';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WarmChannelsRecreatorAllUseCase {
  constructor(
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    filters: RecreateWarmChannelsAllRequest
  ): Promise<{ enqueued: number }> {
    const settings = await this.workerWarmPoolSettingsService.view();
    if (!settings.warmup_enabled) {
      throw new Error(t('warm_pool_warmup_disabled'));
    }

    const warmChannels =
      await this.workerWarmPoolRepository.listReadyWarmChannelsForRecreate(
        this.normalizeFilters(filters)
      );

    if (!warmChannels.length) {
      throw new Error(t('no_warm_channels_to_recreate'));
    }

    await this.workerWarmPoolQueueService.ensure();

    let enqueued = 0;
    for (const warm of warmChannels) {
      if (await this.enqueueRecreate(warm)) {
        enqueued += 1;
      }
    }

    if (enqueued === 0) {
      throw new Error(t('no_warm_channels_to_recreate'));
    }

    return { enqueued };
  }

  /**
   * Deliberately private: cycling a healthy ready warm runtime is an
   * administrative bulk operation. Automatic capacity reconciliation only
   * publishes deficit signals and cannot reach this tombstone transition.
   */
  private async enqueueRecreate(
    warm: Pick<IWorkerWarmPool, 'warm_pool_id'>
  ): Promise<boolean> {
    const claimed =
      await this.workerWarmPoolRepository.claimReadyForManualRecreate(
        warm.warm_pool_id
      );
    if (!claimed) {
      return false;
    }

    /*
     * The durable tombstone removes the old row from capacity before the new
     * deficit signal is consumed. Producer acknowledgements can be ambiguous,
     * so both independent publications are attempted; stale-delete redrive
     * and the target-fenced replenisher finish either missing side.
     */
    try {
      await this.workerWarmPoolQueueService.publishReplenish({
        request_id: uuidv7(),
        server_id: claimed.server_id,
        worker_type_id: claimed.worker_type_id,
        reason: 'manual',
        requested_at: currentTime(),
      });
    } catch (error) {
      console.error('Failed to publish warm recreate-all replenishment', {
        warm_pool_id: claimed.warm_pool_id,
        server_id: claimed.server_id,
        worker_type_id: claimed.worker_type_id,
        error,
      });
    }

    try {
      await this.workerWarmPoolQueueService.publishDelete({
        request_id: uuidv7(),
        warm_pool_id: claimed.warm_pool_id,
        server_id: claimed.server_id,
        worker_type_id: claimed.worker_type_id,
        container_id: claimed.container_id,
        container_name:
          claimed.container_name || `warm-${claimed.warm_pool_id}`,
        session_volume_name: claimed.session_volume_name,
        remove_volume: false,
        reason: 'manual',
        requested_at: currentTime(),
      });
    } catch (error) {
      console.error('Failed to publish warm recreate-all deletion', {
        warm_pool_id: claimed.warm_pool_id,
        server_id: claimed.server_id,
        worker_type_id: claimed.worker_type_id,
        error,
      });
    }

    return true;
  }

  private normalizeFilters(
    filters: RecreateWarmChannelsAllRequest
  ): RecreateWarmChannelsAllRequest {
    return {
      server_id: filters.server_id || undefined,
      type: filters.type || undefined,
      warm_pool_id: filters.warm_pool_id || undefined,
      container_id: filters.container_id || undefined,
      container_name: filters.container_name || undefined,
      session_volume_name: filters.session_volume_name || undefined,
      search: filters.search || undefined,
      created_at_from: filters.created_at_from || undefined,
      created_at_to: filters.created_at_to || undefined,
      updated_at_from: filters.updated_at_from || undefined,
      updated_at_to: filters.updated_at_to || undefined,
      last_health_at_from: filters.last_health_at_from || undefined,
      last_health_at_to: filters.last_health_at_to || undefined,
    };
  }
}
