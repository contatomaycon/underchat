import { injectable } from 'tsyringe';
import { ConfigService } from '@core/services/config.service';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsFinalResponse } from '@core/schema/config/listChannels/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class ChannelsListerUseCase {
  constructor(private readonly configService: ConfigService) {}

  async execute(
    query: ListChannelsRequest
  ): Promise<ListChannelsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.configService.listChannels(
      perPage,
      currentPage,
      query
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
