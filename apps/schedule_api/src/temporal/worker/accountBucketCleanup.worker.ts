import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { AccountBucketCleanupActivity } from '@core/temporal/activities/accountBucketCleanup.activities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const accountBucketCleanupWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(AccountBucketCleanupActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/accountBucketCleanup.workflow.ts'
    ),
    activities: {
      processExpiredAccountBuckets: activity.processExpiredAccountBuckets,
    },
    taskQueue: 'account-bucket-cleanup-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Account bucket cleanup worker failed');
  });
};
