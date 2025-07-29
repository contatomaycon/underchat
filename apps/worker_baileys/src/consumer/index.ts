import { FastifyInstance } from 'fastify';
import baileysConsume from './baileys.consume';

export default async function (server: FastifyInstance) {
  await server.register(baileysConsume);
}
