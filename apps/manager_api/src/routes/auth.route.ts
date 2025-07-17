import AuthController from '@/controllers/auth';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { loginSchema } from '@core/schema/auth/login';
import { refreshTokenSchema } from '@core/schema/auth/refrehToken';

export default async function authRoutes(server: FastifyInstance) {
  const authController = container.resolve(AuthController);

  server.post('/auth/login', {
    schema: loginSchema,
    handler: authController.login,
  });

  server.post('/auth/refresh-token', {
    schema: refreshTokenSchema,
    handler: authController.refreshToken,
  });
}
