import { proxyActivities } from '@temporalio/workflow';
import { IChatbotInactivityActivity } from '../activities/chatbotInactivity.activities';

const { processScheduledInactivityChecks } =
  proxyActivities<IChatbotInactivityActivity>({
    startToCloseTimeout: '1 minute',
    retry: {
      maximumAttempts: 3,
    },
  });

export async function chatbotInactivityWorkflow(): Promise<void> {
  return processScheduledInactivityChecks();
}
