import { injectable } from 'tsyringe';
import { DashboardService } from '@core/services/dashboard.service';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';

@injectable()
export class DashboardAdditionalViewerUseCase {
  constructor(private readonly dashboardService: DashboardService) {}

  execute = async (
    accountId: string
  ): Promise<GetDashboardAdditionalResponse> => {
    const additional =
      await this.dashboardService.getDashboardAdditional(accountId);
    return additional;
  };
}
