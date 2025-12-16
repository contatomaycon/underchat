import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { DashboardService } from '@core/services/dashboard.service';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';

@injectable()
export class DashboardAdditionalViewerUseCase {
  constructor(private readonly dashboardService: DashboardService) {}

  execute = async (
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<GetDashboardAdditionalResponse> => {
    const additional = await this.dashboardService.getDashboardAdditional(
      accountId,
      t
    );
    return additional;
  };
}
