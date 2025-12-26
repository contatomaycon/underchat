import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fp from 'fastify-plugin';

export default fp(
  async function corsPlugin(fastify: FastifyInstance) {
    fastify.register(cors, {
      origin: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Accept',
        'Accept-Language',
        'X-Requested-With',
        'X-Forwarded-For',
        'X-Real-IP',
        'Origin',
        'Referer',
        'User-Agent',
      ],
      exposedHeaders: ['x-plan-active'],
      credentials: true,
      preflight: true,
    });
  },
  {
    name: 'cors-plugin',
  }
);
