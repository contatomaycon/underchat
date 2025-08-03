import { FastifyInstance } from 'fastify';
import workerCreateConsume from './workerCreate.consume';
import workerDeleteConsume from './workerDelete.consume';
import workerRecreateConsume from './workerRecreate.consume';

export default async function (server: FastifyInstance) {
  await server.register(workerCreateConsume);
  await server.register(workerDeleteConsume);
  await server.register(workerRecreateConsume);
}
