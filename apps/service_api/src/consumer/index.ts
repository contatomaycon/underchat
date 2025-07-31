import { FastifyInstance } from 'fastify';
import balanceConsume from './balance.consume';
import workerConsume from './worker.consume';

export default async function (server: FastifyInstance) {
  await server.register(balanceConsume);
  await server.register(workerConsume);
}
