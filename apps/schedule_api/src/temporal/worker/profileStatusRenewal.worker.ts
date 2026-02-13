import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ProfileStatusRenewalActivity } from '@core/temporal/activities/profileStatusRenewal.activities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const profileStatusRenewalWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ProfileStatusRenewalActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/profileStatusRenewal.workflow.ts'
    ),
    activities: {
      renewPermanentStatuses: activity.renewPermanentStatuses,
    },
    taskQueue: 'profile-status-renewal-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Profile status renewal worker failed');
  });
};
