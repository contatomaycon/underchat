import { FastifyInstance } from 'fastify';
import connectionConsume from './connection.consume';
import sendMessageConsume from './sendMessage.consume';

export default async function (server: FastifyInstance) {
  await server.register(connectionConsume);
  await server.register(sendMessageConsume);
}
