import { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { container } from 'tsyringe';
import Redis from 'ioredis';
import { ProfileStatusRenewalActivity } from '@core/jobs/activities/profileStatusRenewal.activities';
import { BalanceMonitorActivity } from '@core/jobs/activities/balanceMonitor.activities';
import { ChatbotInactivityActivity } from '@core/jobs/activities/chatbotInactivity.activities';
import { AttendanceInactivityActivity } from '@core/jobs/activities/attendanceInactivity.activities';
import { OperatorReplyPendingRedistributionActivity } from '@core/jobs/activities/operatorReplyPendingRedistribution.activities';
import { WorkerCreationActivity } from '@core/jobs/activities/workerCreation.activities';
import { PlanRenewalActivity } from '@core/jobs/activities/planRenewal.activities';
import { PlanExpirationReminderActivity } from '@core/jobs/activities/planExpirationReminder.activities';
import { WorkerMonitorActivity } from '@core/jobs/activities/workerMonitor.activities';
import { ScheduleSendActivity } from '@core/jobs/activities/scheduleSend.activities';
import { AccountBucketCleanupActivity } from '@core/jobs/activities/accountBucketCleanup.activities';
import { S3BackupMigrationActivity } from '@core/jobs/activities/s3BackupMigration.activities';
import { WorkerWarmPoolActivity } from '@core/jobs/activities/workerWarmPool.activities';
import { PlanLimitEnforcementActivity } from '@core/jobs/activities/planLimitEnforcement.activities';
import { WhatsappSessionGarbageCollectionActivity } from '@core/jobs/activities/whatsappSessionGarbageCollection.activities';
import { WhatsappProviderHandoffRecoveryActivity } from '@core/jobs/activities/whatsappProviderHandoffRecovery.activities';
import { SessionStorageMigrationActivity } from '@core/jobs/activities/sessionStorageMigration.activities';
import {
  ILockLeaseContext,
  LockAcquisitionTimeoutError,
  UNFENCED_LOCK_LEASE_CONTEXT,
  withLock,
} from '@core/common/functions/withLock';
import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { WORKER_CONTAINER_LIVENESS_CRON_EXPRESSION } from '@core/common/functions/workerContainerLivenessPolicy';
import { BalanceImageRolloutService } from '@core/services/balanceImageRollout.service';
import { buildEnvironment } from '@core/config/environments';

const JOB_TIMEZONE = APP_TIMEZONE;
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
    handler: (context: ILockLeaseContext) => Promise<void>;
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
        await input.handler(UNFENCED_LOCK_LEASE_CONTEXT);
        return;
      }

      try {
        await withLock(redis, `job:cron:${input.jobId}`, input.handler, {
          ttlMs: JOB_LOCK_TTL_MS,
          retryMs: 100,
          maxWaitMs: JOB_LOCK_MAX_WAIT_MS,
        });
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

export interface ICronJobsOptions {
  enableBalanceImageRollout?: boolean;
  enableWarmPoolJobs?: boolean;
  enableWorkerMonitor?: boolean;
}

export function cronJobs(
  server: FastifyInstance,
  options?: ICronJobsOptions
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
  const operatorReplyPendingRedistributionActivity = container.resolve(
    OperatorReplyPendingRedistributionActivity
  );
  const workerCreationActivity = container.resolve(WorkerCreationActivity);
  const planRenewalActivity = container.resolve(PlanRenewalActivity);
  const planExpirationReminderActivity = container.resolve(
    PlanExpirationReminderActivity
  );
  const scheduleSendActivity = container.resolve(ScheduleSendActivity);
  const accountBucketCleanupActivity = container.resolve(
    AccountBucketCleanupActivity
  );
  const s3BackupMigrationActivity = container.resolve(
    S3BackupMigrationActivity
  );
  const workerWarmPoolActivity = container.resolve(WorkerWarmPoolActivity);
  const planLimitEnforcementActivity = container.resolve(
    PlanLimitEnforcementActivity
  );
  const whatsappSessionGarbageCollectionActivity = container.resolve(
    WhatsappSessionGarbageCollectionActivity
  );
  const whatsappProviderHandoffRecoveryActivity = container.resolve(
    WhatsappProviderHandoffRecoveryActivity
  );
  const sessionStorageMigrationActivity = container.resolve(
    SessionStorageMigrationActivity
  );
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
      jobId: 'operator-reply-pending-redistribution-schedule',
      cronExpression: '*/30 * * * * *',
      handler:
        operatorReplyPendingRedistributionActivity.processScheduledRedistributions,
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
    createCronJob(server, redis, {
      jobId: 'plan-limit-enforcement-schedule',
      cronExpression: '0 15 * * * *',
      handler: planLimitEnforcementActivity.processPlanLimitEnforcement,
    }),
    createCronJob(server, redis, {
      jobId: 'whatsapp-provider-handoff-recovery-schedule',
      cronExpression: '*/15 * * * * *',
      handler: whatsappProviderHandoffRecoveryActivity.recoverPendingHandoffs,
    }),
    createCronJob(server, redis, {
      jobId: 'session-storage-migration-redrive-schedule',
      cronExpression: '*/5 * * * * *',
      handler: sessionStorageMigrationActivity.processPending,
    }),
    createCronJob(server, redis, {
      jobId: 'whatsapp-session-garbage-collection-schedule',
      cronExpression: '0 25 * * * *',
      handler: whatsappSessionGarbageCollectionActivity.collectExpiredRevisions,
    }),
  ];

  if (options?.enableWorkerMonitor === true) {
    const workerMonitorActivity = container.resolve(WorkerMonitorActivity);
    jobs.push(
      createCronJob(server, redis, {
        jobId: 'worker-liveness-monitor-schedule',
        cronExpression: WORKER_CONTAINER_LIVENESS_CRON_EXPRESSION,
        handler: workerMonitorActivity.monitorLiveness,
      }),
      createCronJob(server, redis, {
        jobId: 'worker-monitor-schedule',
        cronExpression: '0 */10 * * * *',
        handler: workerMonitorActivity.monitor,
      })
    );
  }

  if (options?.enableWarmPoolJobs === true) {
    jobs.push(
      createCronJob(server, redis, {
        jobId: 'worker-warm-pool-schedule',
        cronExpression: '*/5 * * * * *',
        handler: (leaseContext) => workerWarmPoolActivity.scan(leaseContext),
      })
    );
  }

  if (
    options?.enableBalanceImageRollout === true &&
    buildEnvironment.balanceImageRolloutEnabled
  ) {
    const balanceImageRolloutService = container.resolve(
      BalanceImageRolloutService
    );
    jobs.push(
      createCronJob(server, redis, {
        jobId: 'balance-image-rollout-schedule',
        cronExpression: '*/30 * * * * *',
        handler: () => balanceImageRolloutService.reconcile().then(() => {}),
      })
    );
  }

  return jobs;
}
