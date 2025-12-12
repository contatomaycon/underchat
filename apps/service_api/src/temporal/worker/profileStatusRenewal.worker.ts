import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ProfileStatusRenewalActivity } from '@core/temporal/activities/profileStatusRenewal.activities';
import '@core/temporal/workflows/profileStatusRenewal.workflow';

export const profileStatusRenewalWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ProfileStatusRenewalActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/profileStatusRenewal.workflow'),
    activities: {
      renewPermanentStatuses: activity.renewPermanentStatuses,
    },
    taskQueue: 'profile-status-renewal-queue',
  });

  worker.run();
};
