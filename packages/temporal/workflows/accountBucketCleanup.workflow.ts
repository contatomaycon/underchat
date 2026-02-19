import { proxyActivities } from '@temporalio/workflow';
import { IAccountBucketCleanupActivity } from '../activities/accountBucketCleanup.activities';

const { processExpiredAccountBuckets } =
  proxyActivities<IAccountBucketCleanupActivity>({
    startToCloseTimeout: '2 hours',
    retry: {
      maximumAttempts: 3,
    },
  });

export async function accountBucketCleanupWorkflow(): Promise<void> {
  await processExpiredAccountBuckets();
}
