import { injectable, inject } from 'tsyringe';
import { DashboardService } from '@core/services/dashboard.service';
import { ListOfflineChannelsFinalResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';

@injectable()
export class DashboardOfflineChannelsListerUseCase {
  constructor(
    @inject(DashboardService)
    private readonly dashboardService: DashboardService
  ) {}

  execute = async (
    accountId: string
  ): Promise<ListOfflineChannelsFinalResponse | null> => {
    return this.dashboardService.getDashboardOfflineChannels(accountId);
  };
}
