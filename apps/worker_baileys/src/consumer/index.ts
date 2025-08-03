import { FastifyInstance } from 'fastify';
import connectionConsume from './connection.consume';
import fp from 'fastify-plugin';

const connectionPlugin = async (fastify: FastifyInstance) => {
  await fastify.register(connectionConsume);
};

export default fp(connectionPlugin, { name: 'connection-plugin' });
