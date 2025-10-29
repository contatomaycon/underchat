import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fp from 'fastify-plugin';

export default fp(
  async function corsPlugin(fastify: FastifyInstance) {
    fastify.register(cors, {
      origin: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: '*',
      credentials: true,
      preflight: true,
    });
  },
  {
    name: 'cors-plugin',
  }
);
