import { FastifyInstance } from 'fastify';
import connectionConsume from './connection.consume';

export default async function (server: FastifyInstance) {
  await server.register(connectionConsume);
}
