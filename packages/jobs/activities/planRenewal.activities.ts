import { PlanRenewalService } from '@core/services/planRenewal.service';
import { injectable, inject } from 'tsyringe';

export interface IPlanRenewalActivity {
  processPlanRenewals(): Promise<void>;
}

@injectable()
export class PlanRenewalActivity implements IPlanRenewalActivity {
  constructor(
    @inject(PlanRenewalService)
    private readonly planRenewalService: PlanRenewalService
  ) {}

  processPlanRenewals = async (): Promise<void> => {
    await this.planRenewalService.processRenewals();
  };
}
