import { PlanRenewalService } from '@core/services/planRenewal.service';
import { injectable } from 'tsyringe';

export interface IPlanRenewalActivity {
  processPlanRenewals(): Promise<void>;
}

@injectable()
export class PlanRenewalActivity implements IPlanRenewalActivity {
  constructor(private readonly planRenewalService: PlanRenewalService) {}

  processPlanRenewals = async (): Promise<void> => {
    await this.planRenewalService.processRenewals();
  };
}
