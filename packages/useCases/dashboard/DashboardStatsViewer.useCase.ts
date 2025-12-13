import { inject, injectable } from 'tsyringe';
import { DashboardService } from '@core/services/dashboard.service';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';

@injectable()
export class DashboardStatsViewerUseCase {
  constructor(private readonly dashboardService: DashboardService) {}

  execute = async (
    accountId: string
  ): Promise<GetDashboardStatsResponse | null> => {
    return this.dashboardService.getDashboardStats(accountId);
  };
}
