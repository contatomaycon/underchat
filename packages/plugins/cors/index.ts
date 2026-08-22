import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fp from 'fastify-plugin';

const CORS_PREFLIGHT_CACHE_SECONDS = 600;

export default fp(
  async function corsPlugin(fastify: FastifyInstance) {
    fastify.register(cors, {
      origin: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Authorization',
        'keyapi',
        'x-underchat-user-id',
        'Content-Type',
        'Cache-Control',
        'Pragma',
        'Accept',
        'Accept-Language',
        'X-Requested-With',
        'X-Forwarded-For',
        'X-Real-IP',
        'Origin',
        'Referer',
        'User-Agent',
        'x-client-platform',
        'x-connection-lifecycle-debug-trace-id',
      ],
      exposedHeaders: [
        'x-plan-active',
        'x-ratelimit-limit',
        'x-ratelimit-remaining',
        'x-ratelimit-reset',
        'retry-after',
      ],
      credentials: true,
      preflight: true,
      maxAge: CORS_PREFLIGHT_CACHE_SECONDS,
      cacheControl: CORS_PREFLIGHT_CACHE_SECONDS,
    });
  },
  {
    name: 'cors-plugin',
  }
);
