import { proxyActivities } from '@temporalio/workflow';
import { IPlanRenewalActivity } from '../activities/planRenewal.activities';

const { processPlanRenewals } = proxyActivities<IPlanRenewalActivity>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export async function planRenewalWorkflow(): Promise<void> {
  return processPlanRenewals();
}
