import { injectable, inject } from 'tsyringe';
import { DashboardService } from '@core/services/dashboard.service';
import { ListChannelsStatusFinalResponse } from '@core/schema/dashboard/listChannelsStatus/response.schema';

@injectable()
export class DashboardChannelsStatusListerUseCase {
  constructor(
    @inject(DashboardService)
    private readonly dashboardService: DashboardService
  ) {}

  execute = async (
    accountId: string
  ): Promise<ListChannelsStatusFinalResponse | null> => {
    return this.dashboardService.getDashboardChannelsStatus(accountId);
  };
}
