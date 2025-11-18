import { FastifyInstance } from 'fastify';
import connectionConsume from './connection.consume';
import sendMessageConsume from './sendMessage.consume';
import markMessageReadConsume from './markMessageRead.consume';

export default async function registerConsumers(server: FastifyInstance) {
  await server.register(connectionConsume);
  await server.register(sendMessageConsume);
  await server.register(markMessageReadConsume);
}
