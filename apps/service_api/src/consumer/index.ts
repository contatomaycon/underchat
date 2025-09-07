import { FastifyInstance } from 'fastify';
import balanceConsume from './balance.consume';
import workerConsume from './worker.consume';
import messageUpdateConsume from './updateMessage.consume';
import messageUpsertMessage from './upsertMessage.consume';

export default async function (server: FastifyInstance) {
  await server.register(balanceConsume);
  await server.register(workerConsume);
  await server.register(messageUpdateConsume);
  await server.register(messageUpsertMessage);
}
