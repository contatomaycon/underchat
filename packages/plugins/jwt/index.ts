import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { generalEnvironment } from '@core/config/environments';

async function jwtPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: generalEnvironment.jwtSecret,
    sign: {
      expiresIn: generalEnvironment.jwtSecretExpiresIn,
    },
  });

  fastify.decorate('decodeToken', async (token: string) => {
    if (!token) {
      return null;
    }

    return fastify.jwt.decode(token);
  });

  fastify.decorate('verifyToken', async (token: string) => {
    if (!token) {
      return null;
    }

    return fastify.jwt.verify(token);
  });
}

export default fp(jwtPlugin, { name: 'jwt-plugin' });
