import { FastifyInstance } from 'fastify';
import { serverSchedule } from './schedule/server.schedule';
import { serverWorker } from './worker/server.worker';

export default async function (server: FastifyInstance) {
  await server.register(serverSchedule);
  await server.register(serverWorker);
}
