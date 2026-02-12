import { injectable, inject } from 'tsyringe';
import { DashboardService } from '@core/services/dashboard.service';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';

@injectable()
export class DashboardConversationsViewerUseCase {
  constructor(
    @inject(DashboardService)
    private readonly dashboardService: DashboardService
  ) {}

  execute = async (
    accountId: string
  ): Promise<GetDashboardConversationsResponse | null> => {
    return this.dashboardService.getDashboardConversations(accountId);
  };
}
