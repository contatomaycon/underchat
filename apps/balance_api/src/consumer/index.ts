import { FastifyInstance } from 'fastify';
import workerCreateConsume from './workerCreate.consume';
import workerDeleteConsume from './workerDelete.consume';

export default async function (server: FastifyInstance) {
  await server.register(workerCreateConsume);
  await server.register(workerDeleteConsume);
}
