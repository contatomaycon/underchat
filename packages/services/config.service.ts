import { injectable } from 'tsyringe';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';
import { ChannelViewerRepository } from '@core/repositories/config/ChannelViewer.repository';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';

@injectable()
export class ConfigService {
  constructor(
    private readonly channelsListerRepository: ChannelsListerRepository,
    private readonly channelViewerRepository: ChannelViewerRepository
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

  listAllNonDeletedChannelIds = async (): Promise<string[]> => {
    return this.channelsListerRepository.listAllNonDeletedChannelIds();
  };
}
