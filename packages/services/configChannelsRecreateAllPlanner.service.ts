import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { IConfigChannelsRecreateAllFilters } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import {
  ConfigChannelsRecreateBatchRepository,
  type ConfigChannelsRecreateBatchSource,
  type CreateConfigChannelsRecreateBatchResult,
} from '@core/repositories/config/ConfigChannelsRecreateBatch.repository';
import { ConfigService } from '@core/services/config.service';
import type { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

export interface PrepareConfigChannelsRecreateAllOptions {
  readonly assertActive?: () => void;
}

@injectable()
export class ConfigChannelsRecreateAllPlannerService {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(ConfigChannelsRecreateBatchRepository)
    private readonly batchRepository: ConfigChannelsRecreateBatchRepository
  ) {}

  async prepare(
    t: TFunction<'translation', undefined>,
    source: ConfigChannelsRecreateBatchSource,
    filters: IConfigChannelsRecreateAllFilters,
    options: PrepareConfigChannelsRecreateAllOptions = {}
  ): Promise<CreateConfigChannelsRecreateBatchResult> {
    options.assertActive?.();
    const normalizedFilters = this.normalizeFilters(filters);
    const existing = await this.batchRepository.loadExistingBatch(
      source,
      normalizedFilters
    );
    options.assertActive?.();
    if (existing) {
      return existing;
    }
    const targets =
      await this.configService.listAllNonDeletedChannelRecreateTargets(
        normalizedFilters
      );
    options.assertActive?.();
    const result = await this.batchRepository.createOrLoadBatch(
      source,
      normalizedFilters,
      targets,
      t('no_channels_to_recreate')
    );
    options.assertActive?.();
    return result;
  }

  private normalizeFilters(
    filters: IConfigChannelsRecreateAllFilters
  ): IConfigChannelsRecreateAllFilters {
    return {
      status: filters.status ?? EWorkerStatus.online,
      type: filters.type ?? undefined,
      ...(filters.session_storage
        ? { session_storage: filters.session_storage }
        : {}),
      account: filters.account || undefined,
      name: filters.name || undefined,
      number: filters.number || undefined,
    };
  }
}
