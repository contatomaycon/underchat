import { FastifyInstance } from 'fastify';
import workerConsume from './worker.consume';

export default async function (server: FastifyInstance) {
  await server.register(workerConsume);
}
