import { injectable, inject } from 'tsyringe';
import { ConfigService } from '@core/services/config.service';
import { ChannelsStatisticsResponse } from '@core/schema/config/channelsStatistics/response.schema';

@injectable()
export class ChannelsStatisticsUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService
  ) {}

  async execute(): Promise<ChannelsStatisticsResponse> {
    const statistics = await this.configService.getChannelsStatistics();
    const total = statistics.total;

    if (total === 0) {
      return {
        online: { total: 0, percentage: 0 },
        disponible: { total: 0, percentage: 0 },
        new: { total: 0, percentage: 0 },
        offline: { total: 0, percentage: 0 },
        error: { total: 0, percentage: 0 },
        mismatched: { total: 0, percentage: 0 },
        stopped: { total: 0, percentage: 0 },
        total: 0,
      };
    }

    return {
      online: {
        total: statistics.online,
        percentage: Number.parseFloat(
          ((statistics.online / total) * 100).toFixed(1)
        ),
      },
      disponible: {
        total: statistics.disponible,
        percentage: Number.parseFloat(
          ((statistics.disponible / total) * 100).toFixed(1)
        ),
      },
      new: {
        total: statistics.new,
        percentage: Number.parseFloat(
          ((statistics.new / total) * 100).toFixed(1)
        ),
      },
      offline: {
        total: statistics.offline,
        percentage: Number.parseFloat(
          ((statistics.offline / total) * 100).toFixed(1)
        ),
      },
      error: {
        total: statistics.error,
        percentage: Number.parseFloat(
          ((statistics.error / total) * 100).toFixed(1)
        ),
      },
      mismatched: {
        total: statistics.mismatched,
        percentage: Number.parseFloat(
          ((statistics.mismatched / total) * 100).toFixed(1)
        ),
      },
      stopped: {
        total: statistics.stopped,
        percentage: Number.parseFloat(
          ((statistics.stopped / total) * 100).toFixed(1)
        ),
      },
      total,
    };
  }
}
