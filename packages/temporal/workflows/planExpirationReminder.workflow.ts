import { proxyActivities } from '@temporalio/workflow';
import { IPlanExpirationReminderActivity } from '../activities/planExpirationReminder.activities';

const { processPlanExpirationReminders } =
  proxyActivities<IPlanExpirationReminderActivity>({
    startToCloseTimeout: '30 minutes',
    retry: {
      maximumAttempts: 3,
    },
  });

export async function planExpirationReminderWorkflow(): Promise<void> {
  return processPlanExpirationReminders();
}
