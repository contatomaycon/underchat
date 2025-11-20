import { proxyActivities } from '@temporalio/workflow';
import { IProfileStatusRenewalActivity } from '../activities/profileStatusRenewal.activities';

const { renewPermanentStatuses } =
  proxyActivities<IProfileStatusRenewalActivity>({
    startToCloseTimeout: '10 minutes',
    retry: {
      maximumAttempts: 3,
    },
  });

export async function profileStatusRenewalWorkflow(): Promise<void> {
  return renewPermanentStatuses();
}
