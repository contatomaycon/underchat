import { proxyActivities } from '@temporalio/workflow';
import { IBalanceMonitorActivity } from '../activities/balanceMonitor.activities';

const { monitor } = proxyActivities<IBalanceMonitorActivity>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 5,
  },
});

export async function balanceMonitorWorkflow(): Promise<void> {
  await monitor();
}
