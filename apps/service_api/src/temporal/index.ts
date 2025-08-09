import { FastifyInstance } from 'fastify';
import { serverSchedule } from './schedule/server.schedule';
import { baileysSchedule } from './schedule/baileys.schedule';
import { serverWorker } from './worker/server.worker';
import { baileysWorker } from './worker/baileys.worker';

export default async function (server: FastifyInstance) {
  await server.register(serverSchedule);
  await server.register(baileysSchedule);
  await server.register(serverWorker);
  await server.register(baileysWorker);
}
