import RegisterController from '@/controllers/register';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { sendTwoFactorSchema } from '@core/schema/register/sendTwoFactor';
import { verifyCodeSchema } from '@core/schema/register/verifyCode';

export default function registerRoutes(server: FastifyInstance) {
  const registerController = container.resolve(RegisterController);

  server.post('/register/send-two-factor', {
    schema: sendTwoFactorSchema,
    handler: registerController.sendTwoFactor,
  });

  server.post('/register/verify-code', {
    schema: verifyCodeSchema,
    handler: registerController.verifyCode,
  });
}
