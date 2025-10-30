import { FastifyInstance } from 'fastify';
import workerConsume from './worker.consume';

export default async function registerConsumer(
  server: FastifyInstance
): Promise<void> {
  await server.register(workerConsume);
}
