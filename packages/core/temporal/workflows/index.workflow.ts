import { proxyActivities } from '@temporalio/workflow';
import { IServerActivity } from '../activities';

const { testServers } = proxyActivities<IServerActivity>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 5,
  },
});

export async function serverWorkflow(): Promise<void> {
  return testServers();
}
