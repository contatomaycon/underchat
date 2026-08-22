import { inject, injectable } from 'tsyringe';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export interface IPlanLimitEnforcementActivity {
  processPlanLimitEnforcement(): Promise<void>;
}

@injectable()
export class PlanLimitEnforcementActivity
  implements IPlanLimitEnforcementActivity
{
  constructor(
    @inject(PlanLimitEnforcementService)
    private readonly planLimitEnforcementService: PlanLimitEnforcementService
  ) {}

  processPlanLimitEnforcement = async (): Promise<void> => {
    await this.planLimitEnforcementService.enforceDueAccounts();
  };
}
