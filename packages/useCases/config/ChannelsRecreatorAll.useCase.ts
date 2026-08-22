import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { ChannelRecreatorUseCase } from './ChannelRecreator.useCase';
import { IConfigChannelsRecreateAllFilters } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IConfigChannelRecreateTarget } from '@core/common/interfaces/IConfigChannelRecreateTarget';
import {
  WorkerRecreateServerSlotLease,
  WorkerRecreateServerSlotService,
} from '@core/services/workerRecreateServerSlot.service';
import { getErrorMessage } from '@core/common/functions/toError';

interface IRecreateResultCounter {
  success: number;
  errors: number;
}

export interface ChannelsRecreatorAllExecutionOptions {
  assertActive?: () => void;
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
    filters: IConfigChannelsRecreateAllFilters,
    options: ChannelsRecreatorAllExecutionOptions = {}
  ): Promise<{ success: number; errors: number }> {
    options.assertActive?.();
    const channels = await this.getChannels(t, this.normalizeFilters(filters));
    options.assertActive?.();
    return this.recreateAllChannels(t, channels, options);
  }

  private normalizeFilters(
    filters: IConfigChannelsRecreateAllFilters
  ): IConfigChannelsRecreateAllFilters {
    return {
      ...filters,
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

  private async getChannels(
    t: TFunction<'translation', undefined>,
    filters: IConfigChannelsRecreateAllFilters
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
    channels: IConfigChannelRecreateTarget[],
    options: ChannelsRecreatorAllExecutionOptions
  ): Promise<IRecreateResultCounter> {
    options.assertActive?.();
    const groups = this.groupByServer(channels);
    const counters = await Promise.all(
      Array.from(groups.entries()).map(([serverId, serverChannels]) =>
        this.recreateServerChannels(t, serverId, serverChannels, options)
      )
    );
    options.assertActive?.();

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
    channels: IConfigChannelRecreateTarget[],
    options: ChannelsRecreatorAllExecutionOptions
  ): Promise<IRecreateResultCounter> {
    const counter: IRecreateResultCounter = { success: 0, errors: 0 };
    const workers = Math.min(
      this.workerRecreateServerSlotService.getSlotCount(),
      channels.length
    );
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (nextIndex < channels.length) {
        options.assertActive?.();
        const current = channels[nextIndex];
        nextIndex += 1;

        if (!current) {
          continue;
        }

        const recreated = await this.recreateChannelWithServerSlot(
          t,
          serverId,
          current,
          options
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
    channel: IConfigChannelRecreateTarget,
    options: ChannelsRecreatorAllExecutionOptions
  ): Promise<boolean> {
    let lease: WorkerRecreateServerSlotLease | null = null;
    let slotPassedToLifecycle = false;
    const reservationTtlMs =
      this.workerRecreateServerSlotService.getReservationTtlMs();

    try {
      const token = this.workerRecreateServerSlotService.buildToken(
        channel.worker_id
      );
      lease = await this.workerRecreateServerSlotService.acquire(
        serverId,
        token,
        {
          assertActive: options.assertActive,
          ttlMs: reservationTtlMs,
          reservation: true,
        }
      );
      options.assertActive?.();
      await this.channelRecreatorUseCase.execute(
        t,
        channel.worker_id,
        undefined,
        {
          recreate_server_slot_key: lease.key,
          recreate_server_slot_token: lease.token,
          onLifecycleEnqueued: () => {
            slotPassedToLifecycle = true;
          },
        }
      );
      options.assertActive?.();
      if (!slotPassedToLifecycle) {
        await this.workerRecreateServerSlotService.release(lease);
        lease = null;
        return true;
      }

      await this.workerRecreateServerSlotService.waitForRelease(lease, {
        assertActive: options.assertActive,
      });
      options.assertActive?.();

      return true;
    } catch (error) {
      if (lease && !slotPassedToLifecycle) {
        await this.workerRecreateServerSlotService
          .release(lease)
          .catch(() => undefined);
      }

      console.error('[ChannelsRecreatorAllUseCase] channel recreation failed', {
        worker_id: channel.worker_id,
        server_id: serverId,
        slot_transferred_to_lifecycle: slotPassedToLifecycle,
        error: getErrorMessage(error),
      });

      options.assertActive?.();
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
