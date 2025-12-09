import { injectable } from 'tsyringe';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';

@injectable()
export class ConfigService {
  constructor(
    private readonly channelsListerRepository: ChannelsListerRepository
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
}
