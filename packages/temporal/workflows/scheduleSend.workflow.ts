import { proxyActivities } from '@temporalio/workflow';
import { IScheduleSendActivity } from '../activities/scheduleSend.activities';

const { processScheduleSends } = proxyActivities<IScheduleSendActivity>({
  startToCloseTimeout: '48 hours',
  retry: {
    maximumAttempts: 3,
  },
});

export async function scheduleSendWorkflow(): Promise<void> {
  return processScheduleSends();
}
