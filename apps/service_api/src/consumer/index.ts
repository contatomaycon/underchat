import { FastifyInstance } from 'fastify';
import balanceConsume from './balance.consume';

export default async function (server: FastifyInstance) {
  await server.register(balanceConsume);
}
