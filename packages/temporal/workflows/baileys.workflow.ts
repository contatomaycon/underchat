import { proxyActivities } from '@temporalio/workflow';
import { IBaileysActivity } from '../activities/baileys.activities';

const { listWorkerBaileysActivities, execute } =
  proxyActivities<IBaileysActivity>({
    startToCloseTimeout: '1 minute',
    retry: {
      maximumAttempts: 5,
    },
  });

export async function baileysWorkflow(): Promise<void> {
  const list = await listWorkerBaileysActivities();

  if (list.length === 0) {
    throw new Error('No worker activities found');
  }

  const concurrency = 20;

  for (let i = 0; i < list.length; i += concurrency) {
    await Promise.all(list.slice(i, i + concurrency).map((c) => execute(c)));
  }
}
