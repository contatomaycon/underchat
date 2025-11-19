import { FastifyInstance } from 'fastify';
import chatSummaryClearCentrifugo from './chatSummaryClearCentrifugo';

export default async function registerCentrifugo(server: FastifyInstance) {
  await server.register(chatSummaryClearCentrifugo);
}
