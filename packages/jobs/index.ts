import { FastifyInstance } from 'fastify';
import { cronJobs, ICronJobsOptions } from './cronJobs';

export interface IStartJobsOptions extends ICronJobsOptions {
  enabled?: boolean;
}

export default function startJobs(
  server: FastifyInstance,
  options?: IStartJobsOptions
): void {
  if (options?.enabled === false) {
    server.log.info('Cron jobs disabled for this runtime role');
    return;
  }

  void server.ready().then(
    () => {
      cronJobs(server, options).forEach((job) =>
        server.scheduler.addCronJob(job)
      );
      server.log.info('Cron jobs started');
    },
    (err: unknown) => {
      server.log.error({ err }, 'Failed to start cron jobs');
    }
  );
}
