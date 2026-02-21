import { FastifyInstance } from 'fastify';
import { cronJobs } from './cronJobs';

export default function startJobs(server: FastifyInstance): void {
  void server.ready().then(
    () => {
      cronJobs(server).forEach((job) => server.scheduler.addCronJob(job));
      server.log.info('Cron jobs started');
    },
    (err: unknown) => {
      server.log.error({ err }, 'Failed to start cron jobs');
    }
  );
}
