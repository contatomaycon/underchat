import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { ChannelRecreatorUseCase } from './ChannelRecreator.useCase';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IConfigChannelRecreateTarget } from '@core/common/interfaces/IConfigChannelRecreateTarget';
import {
  WorkerRecreateServerSlotLease,
  WorkerRecreateServerSlotService,
} from '@core/services/workerRecreateServerSlot.service';

interface IRecreateResultCounter {
  success: number;
  errors: number;
}

@injectable()
export class ChannelsRecreatorAllUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(ChannelRecreatorUseCase)
    private readonly channelRecreatorUseCase: ChannelRecreatorUseCase,
    @inject(WorkerRecreateServerSlotService)
    private readonly workerRecreateServerSlotService: WorkerRecreateServerSlotService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<{ success: number; errors: number }> {
    const channels = await this.getChannels(t, this.normalizeFilters(filters));
    return this.recreateAllChannels(t, channels);
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

  private async getChannels(
    t: TFunction<'translation', undefined>,
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<IConfigChannelRecreateTarget[]> {
    const channels =
      await this.configService.listAllNonDeletedChannelRecreateTargets(filters);

    if (channels.length === 0) {
      throw new Error(t('no_channels_to_recreate'));
    }

    return channels;
  }

  private async recreateAllChannels(
    t: TFunction<'translation', undefined>,
    channels: IConfigChannelRecreateTarget[]
  ): Promise<IRecreateResultCounter> {
    const groups = this.groupByServer(channels);
    const counters = await Promise.all(
      Array.from(groups.entries()).map(([serverId, serverChannels]) =>
        this.recreateServerChannels(t, serverId, serverChannels)
      )
    );

    return counters.reduce<IRecreateResultCounter>(
      (total, item) => ({
        success: total.success + item.success,
        errors: total.errors + item.errors,
      }),
      { success: 0, errors: 0 }
    );
  }

  private async recreateServerChannels(
    t: TFunction<'translation', undefined>,
    serverId: string,
    channels: IConfigChannelRecreateTarget[]
  ): Promise<IRecreateResultCounter> {
    const counter: IRecreateResultCounter = { success: 0, errors: 0 };
    const workers = Math.min(
      this.workerRecreateServerSlotService.getSlotCount(),
      channels.length
    );
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (nextIndex < channels.length) {
        const current = channels[nextIndex];
        nextIndex += 1;

        if (!current) {
          continue;
        }

        const recreated = await this.recreateChannelWithServerSlot(
          t,
          serverId,
          current
        );
        if (recreated) {
          counter.success += 1;
        } else {
          counter.errors += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, () => runNext()));

    return counter;
  }

  private async recreateChannelWithServerSlot(
    t: TFunction<'translation', undefined>,
    serverId: string,
    channel: IConfigChannelRecreateTarget
  ): Promise<boolean> {
    let lease: WorkerRecreateServerSlotLease | null = null;
    let slotPassedToLifecycle = false;

    try {
      const token = this.workerRecreateServerSlotService.buildToken(
        channel.worker_id
      );
      lease = await this.workerRecreateServerSlotService.acquire(
        serverId,
        token
      );
      await this.channelRecreatorUseCase.execute(
        t,
        channel.worker_id,
        undefined,
        {
          recreate_server_slot_key: lease.key,
          recreate_server_slot_token: lease.token,
        }
      );
      slotPassedToLifecycle = true;
      await this.workerRecreateServerSlotService.waitForRelease(lease);

      return true;
    } catch {
      if (lease && !slotPassedToLifecycle) {
        await this.workerRecreateServerSlotService
          .release(lease)
          .catch(() => undefined);
      }

      return false;
    }
  }

  private groupByServer(
    channels: IConfigChannelRecreateTarget[]
  ): Map<string, IConfigChannelRecreateTarget[]> {
    const groups = new Map<string, IConfigChannelRecreateTarget[]>();

    for (const channel of channels) {
      const current = groups.get(channel.server_id) ?? [];
      current.push(channel);
      groups.set(channel.server_id, current);
    }

    return groups;
  }
}
