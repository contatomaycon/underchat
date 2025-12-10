import { proxyActivities } from '@temporalio/workflow';
import { IWorkerCreationActivity } from '../activities/workerCreation.activities';

const { listWorkerNewStatusActivities, processWorkerCreation } =
  proxyActivities<IWorkerCreationActivity>({
    startToCloseTimeout: '2 minutes',
    retry: {
      maximumAttempts: 3,
    },
  });

export async function workerCreationWorkflow(): Promise<void> {
  const list = await listWorkerNewStatusActivities();

  if (list.length === 0) {
    return;
  }

  const concurrency = 10;

  for (let i = 0; i < list.length; i += concurrency) {
    await Promise.all(
      list
        .slice(i, i + concurrency)
        .map((worker) => processWorkerCreation(worker))
    );
  }
}
