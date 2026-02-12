import { injectable, inject } from 'tsyringe';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';
import { ChannelViewerRepository } from '@core/repositories/config/ChannelViewer.repository';
import { ChannelsStatisticsRepository } from '@core/repositories/config/ChannelsStatistics.repository';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class ConfigService {
  constructor(
    @inject(ChannelsListerRepository)
    private readonly channelsListerRepository: ChannelsListerRepository,
    @inject(ChannelViewerRepository)
    private readonly channelViewerRepository: ChannelViewerRepository,
    @inject(ChannelsStatisticsRepository)
    private readonly channelsStatisticsRepository: ChannelsStatisticsRepository
  ) {}

  listChannels = async (
    perPage: number,
    currentPage: number,
    query: ListChannelsRequest
  ): Promise<[ListChannelsResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.channelsListerRepository.listChannels(perPage, currentPage, query),
      this.channelsListerRepository.listChannelsTotal(query),
    ]);

    return [result, total];
  };

  viewChannelBalancer = async (
    channelId: string
  ): Promise<IViewWorkerServer | null> => {
    return this.channelViewerRepository.viewChannelBalancer(channelId);
  };

  listAllNonDeletedChannelIds = async (status?: string): Promise<string[]> => {
    return this.channelsListerRepository.listAllNonDeletedChannelIds(status);
  };

  getChannelsStatistics = async (): Promise<{
    online: number;
    disponible: number;
    new: number;
    offline: number;
    error: number;
    mismatched: number;
    stopped: number;
    total: number;
  }> => {
    const { statusCounts, total } =
      await this.channelsStatisticsRepository.getChannelsStatistics();

    const statusMap = new Map<string, number>();
    for (const item of statusCounts) {
      statusMap.set(item.status_id, item.count);
    }

    return {
      online: statusMap.get(EWorkerStatus.online) ?? 0,
      disponible: statusMap.get(EWorkerStatus.disponible) ?? 0,
      new: statusMap.get(EWorkerStatus.new) ?? 0,
      offline: statusMap.get(EWorkerStatus.offline) ?? 0,
      error: statusMap.get(EWorkerStatus.error) ?? 0,
      mismatched: statusMap.get(EWorkerStatus.mismatched) ?? 0,
      stopped: statusMap.get(EWorkerStatus.stopped) ?? 0,
      total,
    };
  };
}
