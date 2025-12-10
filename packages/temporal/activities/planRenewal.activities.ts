import { PlanRenewalService } from '@core/services/planRenewal.service';
import { container } from 'tsyringe';

export interface IPlanRenewalActivity {
  processPlanRenewals(): Promise<void>;
}

export async function processPlanRenewals(): Promise<void> {
  const planRenewalService = container.resolve(PlanRenewalService);

  await planRenewalService.processRenewals();
}
