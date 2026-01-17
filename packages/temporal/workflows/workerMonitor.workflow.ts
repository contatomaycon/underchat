import { proxyActivities } from '@temporalio/workflow';
import { IWorkerMonitorActivity } from '../activities/workerMonitor.activities';

const { monitor } = proxyActivities<IWorkerMonitorActivity>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 5,
  },
});

export async function workerMonitorWorkflow(): Promise<void> {
  await monitor();
}
