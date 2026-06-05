import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WarmChannelRecreatorUseCase } from './WarmChannelRecreator.useCase';
import { RecreateWarmChannelsAllRequest } from '@core/schema/config/recreateWarmChannelsAll/request.schema';

@injectable()
export class WarmChannelsRecreatorAllUseCase {
  constructor(
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WarmChannelRecreatorUseCase)
    private readonly warmChannelRecreatorUseCase: WarmChannelRecreatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    filters: RecreateWarmChannelsAllRequest
  ): Promise<{ enqueued: number }> {
    const warmChannels =
      await this.workerWarmPoolRepository.listReadyWarmChannelsForRecreate(
        this.normalizeFilters(filters)
      );

    if (!warmChannels.length) {
      throw new Error(t('no_warm_channels_to_recreate'));
    }

    for (const warm of warmChannels) {
      await this.warmChannelRecreatorUseCase.enqueueRecreate(warm);
    }

    return { enqueued: warmChannels.length };
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
