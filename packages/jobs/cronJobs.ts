import { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { container } from 'tsyringe';
import Redis from 'ioredis';
import { ProfileStatusRenewalActivity } from '@core/jobs/activities/profileStatusRenewal.activities';
import { BalanceMonitorActivity } from '@core/jobs/activities/balanceMonitor.activities';
import { ChatbotInactivityActivity } from '@core/jobs/activities/chatbotInactivity.activities';
import { AttendanceInactivityActivity } from '@core/jobs/activities/attendanceInactivity.activities';
import { WorkerCreationActivity } from '@core/jobs/activities/workerCreation.activities';
import { PlanRenewalActivity } from '@core/jobs/activities/planRenewal.activities';
import { PlanExpirationReminderActivity } from '@core/jobs/activities/planExpirationReminder.activities';
import { WorkerMonitorActivity } from '@core/jobs/activities/workerMonitor.activities';
import { ScheduleSendActivity } from '@core/jobs/activities/scheduleSend.activities';
import { AccountBucketCleanupActivity } from '@core/jobs/activities/accountBucketCleanup.activities';
import { S3BackupMigrationActivity } from '@core/jobs/activities/s3BackupMigration.activities';
import { WorkerWarmPoolActivity } from '@core/jobs/activities/workerWarmPool.activities';
import { workerPoolEnvironment } from '@core/config/environments';
import {
  LockAcquisitionTimeoutError,
  withLock,
} from '@core/common/functions/withLock';

const JOB_TIMEZONE = 'America/Sao_Paulo';
const WORKER_CREATION_CONCURRENCY = 10;
const JOB_LOCK_TTL_MS = 60000;
const JOB_LOCK_MAX_WAIT_MS = 500;

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
  redis: Redis,
  input: {
    jobId: string;
    cronExpression: string;
    handler: () => Promise<void>;
    preventOverrun?: boolean;
    useDistributedLock?: boolean;
  }
): CronJob => {
  return new CronJob(
    {
      cronExpression: input.cronExpression,
      timezone: JOB_TIMEZONE,
    },
    createAsyncTask(server, input.jobId, async () => {
      if (input.useDistributedLock === false) {
        await input.handler();
        return;
      }

      try {
        await withLock(
          redis,
          `job:cron:${input.jobId}`,
          async () => input.handler(),
          {
            ttlMs: JOB_LOCK_TTL_MS,
            retryMs: 100,
            maxWaitMs: JOB_LOCK_MAX_WAIT_MS,
          }
        );
      } catch (error) {
        if (error instanceof LockAcquisitionTimeoutError) {
          return;
        }

        throw error;
      }
    }),
    {
      id: input.jobId,
      preventOverrun: input.preventOverrun ?? true,
    }
  );
};

export function cronJobs(
  server: FastifyInstance,
  options?: { enableWarmPoolJobs?: boolean }
): CronJob[] {
  const profileStatusRenewalActivity = container.resolve(
    ProfileStatusRenewalActivity
  );
  const balanceMonitorActivity = container.resolve(BalanceMonitorActivity);
  const chatbotInactivityActivity = container.resolve(
    ChatbotInactivityActivity
  );
  const attendanceInactivityActivity = container.resolve(
    AttendanceInactivityActivity
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
  const s3BackupMigrationActivity = container.resolve(
    S3BackupMigrationActivity
  );
  const workerWarmPoolActivity = container.resolve(WorkerWarmPoolActivity);
  const redis = container.resolve<Redis>('Redis');

  const jobs = [
    createCronJob(server, redis, {
      jobId: 'profile-status-renewal-schedule',
      cronExpression: '0 0 * * * *',
      handler: profileStatusRenewalActivity.renewPermanentStatuses,
    }),
    createCronJob(server, redis, {
      jobId: 'balance-monitor-schedule',
      cronExpression: '0 * * * * *',
      handler: balanceMonitorActivity.monitor,
    }),
    createCronJob(server, redis, {
      jobId: 'chatbot-inactivity-schedule',
      cronExpression: '*/30 * * * * *',
      handler: chatbotInactivityActivity.processScheduledInactivityChecks,
    }),
    createCronJob(server, redis, {
      jobId: 'attendance-inactivity-schedule',
      cronExpression: '*/30 * * * * *',
      handler: attendanceInactivityActivity.processScheduledInactivityChecks,
    }),
    createCronJob(server, redis, {
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
    createCronJob(server, redis, {
      jobId: 'plan-renewal-schedule',
      cronExpression: '0 0 * * * *',
      handler: planRenewalActivity.processPlanRenewals,
    }),
    createCronJob(server, redis, {
      jobId: 'plan-expiration-reminder-schedule',
      cronExpression: '0 0 * * * *',
      handler: planExpirationReminderActivity.processPlanExpirationReminders,
    }),
    createCronJob(server, redis, {
      jobId: 'worker-monitor-schedule',
      cronExpression: '0 */10 * * * *',
      handler: workerMonitorActivity.monitor,
    }),
    createCronJob(server, redis, {
      jobId: 'schedule-send-schedule',
      cronExpression: '0 * * * * *',
      handler: scheduleSendActivity.processScheduleSends,
      preventOverrun: false,
      useDistributedLock: false,
    }),
    createCronJob(server, redis, {
      jobId: 'account-bucket-cleanup-schedule',
      cronExpression: '0 0 0 * * *',
      handler: accountBucketCleanupActivity.processExpiredAccountBuckets,
    }),
    createCronJob(server, redis, {
      jobId: 's3-backup-migration-schedule',
      cronExpression: '0 0 3 * * *',
      handler: s3BackupMigrationActivity.processPendingS3BackupUploads,
    }),
  ];

  if (
    options?.enableWarmPoolJobs === true &&
    workerPoolEnvironment.warmWorkerPoolEnabled
  ) {
    jobs.push(
      createCronJob(server, redis, {
        jobId: 'worker-warm-pool-schedule',
        cronExpression: `*/${workerPoolEnvironment.warmWorkerScanIntervalSeconds} * * * * *`,
        handler: () => workerWarmPoolActivity.scan(),
      })
    );
  }

  return jobs;
}
