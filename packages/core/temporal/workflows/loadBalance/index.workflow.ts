import { ILoadBalanceActivity } from '@core/temporal/activities/loadBalance/queue.activity';
import { proxyActivities } from '@temporalio/workflow';

const {} = proxyActivities<ILoadBalanceActivity>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 2,
  },
});

export async function loadBalanceQueueWorkflow(): Promise<void> {
  console.log('Load balance workflow started');
}
