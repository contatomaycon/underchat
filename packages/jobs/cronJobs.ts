import { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { container } from 'tsyringe';
import { ProfileStatusRenewalActivity } from '@core/jobs/activities/profileStatusRenewal.activities';
import { BalanceMonitorActivity } from '@core/jobs/activities/balanceMonitor.activities';
import { ChatbotInactivityActivity } from '@core/jobs/activities/chatbotInactivity.activities';
import { WorkerCreationActivity } from '@core/jobs/activities/workerCreation.activities';
import { PlanRenewalActivity } from '@core/jobs/activities/planRenewal.activities';
import { PlanExpirationReminderActivity } from '@core/jobs/activities/planExpirationReminder.activities';
import { WorkerMonitorActivity } from '@core/jobs/activities/workerMonitor.activities';
import { ScheduleSendActivity } from '@core/jobs/activities/scheduleSend.activities';
import { AccountBucketCleanupActivity } from '@core/jobs/activities/accountBucketCleanup.activities';

const JOB_TIMEZONE = 'America/Sao_Paulo';
const WORKER_CREATION_CONCURRENCY = 10;

const createAsyncTask = (
  server: FastifyInstance,
  taskName: string,
  handler: () => Promise<void>
): AsyncTask => {
  return new AsyncTask(
    taskName,
    async () => {
      await handler();
    },
    (err: Error) => {
      server.log.error({ err }, `Cron job "${taskName}" failed`);
    }
  );
};

const createCronJob = (
  server: FastifyInstance,
  input: {
    jobId: string;
    cronExpression: string;
    handler: () => Promise<void>;
    preventOverrun?: boolean;
  }
): CronJob => {
  return new CronJob(
    {
      cronExpression: input.cronExpression,
      timezone: JOB_TIMEZONE,
    },
    createAsyncTask(server, input.jobId, input.handler),
    {
      id: input.jobId,
      preventOverrun: input.preventOverrun ?? true,
    }
  );
};

export function cronJobs(server: FastifyInstance): CronJob[] {
  const profileStatusRenewalActivity = container.resolve(
    ProfileStatusRenewalActivity
  );
  const balanceMonitorActivity = container.resolve(BalanceMonitorActivity);
  const chatbotInactivityActivity = container.resolve(
    ChatbotInactivityActivity
  );
  const workerCreationActivity = container.resolve(WorkerCreationActivity);
  const planRenewalActivity = container.resolve(PlanRenewalActivity);
  const planExpirationReminderActivity = container.resolve(
    PlanExpirationReminderActivity
  );
  const workerMonitorActivity = container.resolve(WorkerMonitorActivity);
  const scheduleSendActivity = container.resolve(ScheduleSendActivity);
  const accountBucketCleanupActivity = container.resolve(
    AccountBucketCleanupActivity
  );

  return [
    createCronJob(server, {
      jobId: 'profile-status-renewal-schedule',
      cronExpression: '0 0 * * * *',
      handler: profileStatusRenewalActivity.renewPermanentStatuses,
    }),
    createCronJob(server, {
      jobId: 'balance-monitor-schedule',
      cronExpression: '0 * * * * *',
      handler: balanceMonitorActivity.monitor,
    }),
    createCronJob(server, {
      jobId: 'chatbot-inactivity-schedule',
      cronExpression: '*/30 * * * * *',
      handler: chatbotInactivityActivity.processScheduledInactivityChecks,
    }),
    createCronJob(server, {
      jobId: 'worker-creation-schedule',
      cronExpression: '0 * * * * *',
      handler: async () => {
        const workers =
          await workerCreationActivity.listWorkerNewStatusActivities();

        if (!workers.length) {
          return;
        }

        for (
          let index = 0;
          index < workers.length;
          index += WORKER_CREATION_CONCURRENCY
        ) {
          const chunk = workers.slice(
            index,
            index + WORKER_CREATION_CONCURRENCY
          );

          await Promise.all(
            chunk.map((worker) =>
              workerCreationActivity.processWorkerCreation(worker)
            )
          );
        }
      },
    }),
    createCronJob(server, {
      jobId: 'plan-renewal-schedule',
      cronExpression: '0 0 * * * *',
      handler: planRenewalActivity.processPlanRenewals,
    }),
    createCronJob(server, {
      jobId: 'plan-expiration-reminder-schedule',
      cronExpression: '0 0 * * * *',
      handler: planExpirationReminderActivity.processPlanExpirationReminders,
    }),
    createCronJob(server, {
      jobId: 'worker-monitor-schedule',
      cronExpression: '0 */10 * * * *',
      handler: workerMonitorActivity.monitor,
    }),
    createCronJob(server, {
      jobId: 'schedule-send-schedule',
      cronExpression: '0 * * * * *',
      handler: scheduleSendActivity.processScheduleSends,
      preventOverrun: false,
    }),
    createCronJob(server, {
      jobId: 'account-bucket-cleanup-schedule',
      cronExpression: '0 0 0 * * *',
      handler: accountBucketCleanupActivity.processExpiredAccountBuckets,
    }),
  ];
}
