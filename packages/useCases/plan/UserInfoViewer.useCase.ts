import { injectable, inject } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';

@injectable()
export class UserInfoViewerUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService
  ) {}

  execute = async (userId: string): Promise<ViewUserInfoResponse | null> => {
    return this.planService.viewUserInfo(userId);
  };
}
