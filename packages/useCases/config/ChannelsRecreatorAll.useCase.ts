import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { ChannelRecreatorUseCase } from './ChannelRecreator.useCase';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class ChannelsRecreatorAllUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(ChannelRecreatorUseCase)
    private readonly channelRecreatorUseCase: ChannelRecreatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<{ success: number; errors: number }> {
    const channelIds = await this.getChannelIds(
      t,
      this.normalizeFilters(filters)
    );
    const results = await this.recreateAllChannels(t, channelIds);
    return this.countResults(results);
  }

  private normalizeFilters(
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Omit<IConfigChannelsRecreateAllPayload, 'account_id'> {
    return {
      ...filters,
      status: filters.status ?? EWorkerStatus.online,
      type: filters.type ?? undefined,
      account: filters.account || undefined,
      name: filters.name || undefined,
      number: filters.number || undefined,
    };
  }

  private async getChannelIds(
    t: TFunction<'translation', undefined>,
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<string[]> {
    const channelIds =
      await this.configService.listAllNonDeletedChannelIds(filters);

    if (channelIds.length === 0) {
      throw new Error(t('no_channels_to_recreate'));
    }

    return channelIds;
  }

  private async recreateAllChannels(
    t: TFunction<'translation', undefined>,
    channelIds: string[]
  ): Promise<PromiseSettledResult<unknown>[]> {
    const recreatePromises = channelIds.map((channelId) =>
      this.channelRecreatorUseCase.execute(t, channelId)
    );

    return Promise.allSettled(recreatePromises);
  }

  private countResults(results: PromiseSettledResult<unknown>[]): {
    success: number;
    errors: number;
  } {
    let success = 0;
    let errors = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        success++;
        continue;
      }

      errors++;
    }

    return { success, errors };
  }
}
