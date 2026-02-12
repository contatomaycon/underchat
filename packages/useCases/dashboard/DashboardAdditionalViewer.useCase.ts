import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { DashboardService } from '@core/services/dashboard.service';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';

@injectable()
export class DashboardAdditionalViewerUseCase {
  constructor(
    @inject(DashboardService)
    private readonly dashboardService: DashboardService
  ) {}

  execute = async (
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<GetDashboardAdditionalResponse> => {
    if (!accountId || typeof accountId !== 'string') {
      throw new Error(t('not_authorized'));
    }

    const additional = await this.dashboardService.getDashboardAdditional(
      accountId,
      t
    );
    return additional;
  };
}
